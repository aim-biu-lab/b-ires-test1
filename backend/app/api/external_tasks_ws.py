"""
WebSocket handler for External Task real-time communication
"""
from datetime import datetime
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
import logging
import asyncio

from app.core.database import get_collection
from app.core.redis_client import get_redis
from app.models.external_task import (
    ExternalTaskStatus,
    WSMessageType,
)
from app.models.event import EventType
from app.api.external_tasks import (
    get_task_by_token,
    update_task_in_redis,
    EXTERNAL_TASK_TOKEN_PREFIX,
)

logger = logging.getLogger(__name__)
router = APIRouter()


class ConnectionManager:
    """
    Manages WebSocket connections for external tasks.
    Each task can have two connections:
    - shell: The experiment shell waiting for task completion
    - external_app: The external application performing the task
    """
    
    def __init__(self):
        # Map: task_token -> {"shell": WebSocket, "external_app": WebSocket}
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()
    
    async def connect(self, task_token: str, websocket: WebSocket, client_type: str):
        """Register a new connection"""
        await websocket.accept()
        
        async with self._lock:
            if task_token not in self.active_connections:
                self.active_connections[task_token] = {}
            
            # Close existing connection of same type if any
            existing = self.active_connections[task_token].get(client_type)
            if existing:
                try:
                    await existing.close()
                except Exception:
                    pass
            
            self.active_connections[task_token][client_type] = websocket
        
        logger.info(f"WebSocket connected: {client_type} for task {task_token}")
    
    async def disconnect(self, task_token: str, client_type: str):
        """Remove a connection"""
        async with self._lock:
            if task_token in self.active_connections:
                if client_type in self.active_connections[task_token]:
                    del self.active_connections[task_token][client_type]
                
                # Clean up if no connections left
                if not self.active_connections[task_token]:
                    del self.active_connections[task_token]
        
        logger.info(f"WebSocket disconnected: {client_type} for task {task_token}")
    
    async def send_to_shell(self, task_token: str, message: dict):
        """Send message to the shell client"""
        async with self._lock:
            if task_token in self.active_connections:
                shell_ws = self.active_connections[task_token].get("shell")
                if shell_ws:
                    try:
                        await shell_ws.send_json(message)
                        return True
                    except Exception as e:
                        logger.error(f"Failed to send to shell: {e}")
        return False
    
    async def send_to_external_app(self, task_token: str, message: dict):
        """Send message to the external app client"""
        async with self._lock:
            if task_token in self.active_connections:
                ext_ws = self.active_connections[task_token].get("external_app")
                if ext_ws:
                    try:
                        await ext_ws.send_json(message)
                        return True
                    except Exception as e:
                        logger.error(f"Failed to send to external app: {e}")
        return False
    
    def is_shell_connected(self, task_token: str) -> bool:
        """Check if shell is connected"""
        return (
            task_token in self.active_connections and
            "shell" in self.active_connections[task_token]
        )
    
    def is_external_app_connected(self, task_token: str) -> bool:
        """Check if external app is connected"""
        return (
            task_token in self.active_connections and
            "external_app" in self.active_connections[task_token]
        )


# Global connection manager
manager = ConnectionManager()


async def log_event(session_id: str, experiment_id: str, user_id: str, 
                    participant_number: int, stage_id: str, 
                    event_type: str, payload: dict = None):
    """Log an event to the database"""
    from uuid import uuid4
    
    events = get_collection("events")
    now = datetime.utcnow()
    
    event_doc = {
        "_id": str(uuid4()),
        "event_id": str(uuid4()),
        "idempotency_key": str(uuid4()),
        "session_id": session_id,
        "experiment_id": experiment_id,
        "user_id": user_id,
        "participant_number": participant_number,
        "participant_label": None,
        "event_type": event_type,
        "stage_id": stage_id,
        "block_id": "external_task",
        "payload": payload or {},
        "metadata": {},
        "client_timestamp": now,
        "server_timestamp": now,
    }
    
    await events.insert_one(event_doc)


@router.websocket("/ws/external-task/{task_token}")
async def external_task_websocket(websocket: WebSocket, task_token: str):
    """
    WebSocket endpoint for external task communication.
    
    Both shell and external app connect to the same endpoint.
    The client type is determined by the first message sent.
    """
    # Validate task token
    task_data = await get_task_by_token(task_token)
    if not task_data:
        await websocket.close(code=4004, reason="Task not found or expired")
        return
    
    # Accept connection (we'll determine client type from first message)
    await websocket.accept()
    
    client_type = None
    
    try:
        # Wait for client identification message
        first_message = await asyncio.wait_for(
            websocket.receive_json(),
            timeout=10.0  # 10 second timeout for identification
        )
        
        # Determine client type from message
        msg_type = first_message.get("type", "")
        
        if msg_type == "shell_connect":
            client_type = "shell"
            await handle_shell_connection(websocket, task_token, task_data, first_message)
        elif msg_type == "ready" or msg_type == "external_app_connect":
            client_type = "external_app"
            await handle_external_app_connection(websocket, task_token, task_data, first_message)
        else:
            await websocket.close(code=4000, reason="Invalid client identification")
            return
            
    except asyncio.TimeoutError:
        await websocket.close(code=4001, reason="Connection timeout - no identification message")
    except WebSocketDisconnect:
        logger.info(f"WebSocket disconnected during handshake for task {task_token}")
    except Exception as e:
        logger.error(f"WebSocket error for task {task_token}: {e}")
        try:
            await websocket.close(code=4002, reason=str(e))
        except Exception:
            pass
    finally:
        if client_type:
            await manager.disconnect(task_token, client_type)
            
            # Update task data
            if client_type == "external_app":
                await update_task_in_redis(task_token, {"external_app_connected": False})
                # Notify shell
                await manager.send_to_shell(task_token, {
                    "type": WSMessageType.EXTERNAL_APP_DISCONNECTED.value,
                    "timestamp": datetime.utcnow().isoformat(),
                })
            elif client_type == "shell":
                await update_task_in_redis(task_token, {"shell_connected": False})


async def handle_shell_connection(websocket: WebSocket, task_token: str, 
                                   task_data: dict, first_message: dict):
    """Handle WebSocket connection from the experiment shell"""
    # Register connection
    # Note: websocket already accepted, need to re-register properly
    async with manager._lock:
        if task_token not in manager.active_connections:
            manager.active_connections[task_token] = {}
        manager.active_connections[task_token]["shell"] = websocket
    
    # Update task data
    await update_task_in_redis(task_token, {"shell_connected": True})
    
    logger.info(f"Shell connected for task {task_token}")
    
    # Send current task status (include close_window if task is completed)
    await websocket.send_json({
        "type": "status",
        "payload": {
            "status": task_data["status"],
            "progress": task_data.get("progress", 0),
            "current_step": task_data.get("current_step"),
            "external_app_connected": task_data.get("external_app_connected", False),
            "data": task_data.get("data"),
            "close_window": task_data.get("close_window", False),  # Include close_window flag
        },
        "timestamp": datetime.utcnow().isoformat(),
    })
    
    # Handle incoming messages from shell
    try:
        while True:
            message = await websocket.receive_json()
            await handle_shell_message(websocket, task_token, task_data, message)
    except WebSocketDisconnect:
        logger.info(f"Shell disconnected for task {task_token}")


async def handle_shell_message(websocket: WebSocket, task_token: str, 
                               task_data: dict, message: dict):
    """Handle messages from the shell client"""
    msg_type = message.get("type", "")
    payload = message.get("payload", {})
    
    if msg_type == "send_command":
        # Forward command to external app
        command = payload.get("command")
        command_data = payload.get("data", {})
        
        success = await manager.send_to_external_app(task_token, {
            "type": WSMessageType.COMMAND.value,
            "payload": {
                "command": command,
                **command_data,
            },
            "timestamp": datetime.utcnow().isoformat(),
        })
        
        # Log the command
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_COMMAND_SENT.value,
            payload={"command": command, "delivered": success},
        )
        
        # Acknowledge to shell
        await websocket.send_json({
            "type": "command_sent",
            "payload": {
                "command": command,
                "delivered": success,
            },
            "timestamp": datetime.utcnow().isoformat(),
        })
    
    elif msg_type == "ping":
        await websocket.send_json({
            "type": "pong",
            "timestamp": datetime.utcnow().isoformat(),
        })


async def handle_external_app_connection(websocket: WebSocket, task_token: str,
                                          task_data: dict, first_message: dict):
    """Handle WebSocket connection from the external application"""
    # Register connection
    async with manager._lock:
        if task_token not in manager.active_connections:
            manager.active_connections[task_token] = {}
        manager.active_connections[task_token]["external_app"] = websocket
    
    now = datetime.utcnow()
    
    # Update task data
    await update_task_in_redis(task_token, {
        "external_app_connected": True,
        "status": ExternalTaskStatus.STARTED.value,
        "started_at": now.isoformat(),
    })
    
    logger.info(f"External app connected for task {task_token}")
    
    # Send init config to external app
    await websocket.send_json({
        "type": WSMessageType.INIT.value,
        "payload": {
            "session_id": task_data["session_id"],
            "stage_id": task_data["stage_id"],
            "config": task_data.get("config", {}),
            "participant_number": task_data["participant_number"],
        },
        "timestamp": now.isoformat(),
    })
    
    # Notify shell that external app connected
    await manager.send_to_shell(task_token, {
        "type": WSMessageType.EXTERNAL_APP_CONNECTED.value,
        "timestamp": now.isoformat(),
    })
    
    # Log event
    await log_event(
        session_id=task_data["session_id"],
        experiment_id=task_data["experiment_id"],
        user_id=task_data["user_id"],
        participant_number=task_data["participant_number"],
        stage_id=task_data["stage_id"],
        event_type=EventType.EXTERNAL_TASK_APP_CONNECTED.value,
        payload={},
    )
    
    # Handle incoming messages from external app
    try:
        while True:
            message = await websocket.receive_json()
            await handle_external_app_message(websocket, task_token, task_data, message)
    except WebSocketDisconnect:
        logger.info(f"External app disconnected for task {task_token}")


async def handle_external_app_message(websocket: WebSocket, task_token: str,
                                       task_data: dict, message: dict):
    """Handle messages from the external app client"""
    msg_type = message.get("type", "")
    payload = message.get("payload", {})
    now = datetime.utcnow()
    
    # Debug logging - log ALL incoming messages from external app
    logger.info(f"[DEBUG] External app message received: type={msg_type}, payload_keys={list(payload.keys()) if payload else []}, task={task_token[:8]}...")
    
    # Refresh task data
    task_data = await get_task_by_token(task_token) or task_data
    
    if msg_type == WSMessageType.READY.value:
        # External app signals it's ready
        await update_task_in_redis(task_token, {
            "status": ExternalTaskStatus.IN_PROGRESS.value,
        })
        
        # Log event
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_READY.value,
            payload={},
        )
    
    elif msg_type == WSMessageType.LOG.value:
        # Log event from external app
        event_type = payload.get("event_type", "custom")
        event_data = payload.get("data", {})
        
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_LOG.value,
            payload={"custom_event_type": event_type, **event_data},
        )
    
    elif msg_type == WSMessageType.PROGRESS.value:
        # Progress update
        progress = payload.get("progress", 0)
        step = payload.get("step")
        
        await update_task_in_redis(task_token, {
            "progress": progress,
            "current_step": step,
            "status": ExternalTaskStatus.IN_PROGRESS.value,
        })
        
        # Forward to shell
        await manager.send_to_shell(task_token, {
            "type": WSMessageType.PROGRESS_UPDATE.value,
            "payload": {
                "progress": progress,
                "step": step,
            },
            "timestamp": now.isoformat(),
        })
        
        # Log event
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_PROGRESS.value,
            payload={"progress": progress, "step": step},
        )
    
    elif msg_type == WSMessageType.COMPLETE.value:
        # Task completed
        logger.info(f"[DEBUG] Processing COMPLETE message for task {task_token[:8]}...")
        data = payload.get("data", {})
        close_window = payload.get("close_window", False)
        logger.info(f"[DEBUG] COMPLETE payload: data_keys={list(data.keys()) if data else []}, close_window={close_window}")
        
        # Store close_window flag in Redis so it can be retrieved on shell reconnection
        await update_task_in_redis(task_token, {
            "status": ExternalTaskStatus.COMPLETED.value,
            "progress": 100,
            "data": data,
            "completed_at": now.isoformat(),
            "close_window": close_window,  # Persist close_window flag
        })
        
        # Notify shell (include close_window flag so parent can close popup)
        shell_notified = await manager.send_to_shell(task_token, {
            "type": WSMessageType.TASK_COMPLETED.value,
            "payload": {
                "data": data,
                "close_window": close_window,
            },
            "timestamp": now.isoformat(),
        })
        
        logger.info(f"[DEBUG] task_completed sent to shell: success={shell_notified}, close_window={close_window}")
        
        # If close_window was requested but shell wasn't notified, send close command to external app
        # so it can try to close itself via window.close() or postMessage
        if close_window and not shell_notified:
            logger.warning(f"[DEBUG] Shell not connected for close_window, sending close command to external app")
            await websocket.send_json({
                "type": WSMessageType.COMMAND.value,
                "payload": {"command": "close"},
                "timestamp": now.isoformat(),
            })
        
        # Log event
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_COMPLETE.value,
            payload={"data": data, "close_window": close_window, "shell_notified": shell_notified},
        )
        
        logger.info(f"External task {task_token} completed (close_window={close_window}, shell_notified={shell_notified})")
    
    elif msg_type == WSMessageType.COMMAND_ACK.value:
        # Command acknowledgment
        command = payload.get("command")
        success = payload.get("success", False)
        
        # Forward to shell
        await manager.send_to_shell(task_token, {
            "type": "command_ack_received",
            "payload": {
                "command": command,
                "success": success,
            },
            "timestamp": now.isoformat(),
        })
        
        # Log event
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_COMMAND_ACK.value,
            payload={"command": command, "success": success},
        )
    
    elif msg_type == WSMessageType.CLOSE_WINDOW_REQUEST.value:
        # External task requests parent to close its popup window
        # This handles cross-domain window closing when window.close() doesn't work
        # Flow: Parent sends close command -> Child receives, calls _closeWindow() ->
        #       Child sends close_window_request via WebSocket -> Parent closes popup
        logger.info(f"[DEBUG] Processing CLOSE_WINDOW_REQUEST for task {task_token[:8]}...")
        
        # Forward to shell so it can close the popup window
        await manager.send_to_shell(task_token, {
            "type": WSMessageType.CLOSE_WINDOW_REQUEST.value,
            "timestamp": now.isoformat(),
        })
        
        # Log event
        await log_event(
            session_id=task_data["session_id"],
            experiment_id=task_data["experiment_id"],
            user_id=task_data["user_id"],
            participant_number=task_data["participant_number"],
            stage_id=task_data["stage_id"],
            event_type=EventType.EXTERNAL_TASK_CLOSE_WINDOW_REQUEST.value,
            payload={},
        )
    
    else:
        # Unrecognized message type
        logger.warning(f"[DEBUG] Unrecognized message type from external app: '{msg_type}' for task {task_token[:8]}...")



