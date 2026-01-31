"""
WebSocket handler for External Task real-time communication

NOTE: This module uses Redis pub/sub for cross-worker communication.
When running with multiple workers (e.g., gunicorn --workers 4), 
the shell and external_app might connect to different workers.
Redis pub/sub ensures messages are forwarded between workers.
"""
from datetime import datetime
from typing import Dict, Set, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import json
import logging
import asyncio
import uuid

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

# Redis channel for cross-worker WebSocket communication
EXTERNAL_TASK_WS_CHANNEL = "external_task_ws_messages"


class ConnectionManager:
    """
    Manages WebSocket connections for external tasks.
    Each task can have two connections:
    - shell: The experiment shell waiting for task completion
    - external_app: The external application performing the task
    
    Uses Redis pub/sub for cross-worker communication when running
    with multiple gunicorn workers.
    """
    
    def __init__(self):
        # Map: task_token -> {"shell": WebSocket, "external_app": WebSocket}
        self.active_connections: Dict[str, Dict[str, WebSocket]] = {}
        # Lock for thread-safe operations
        self._lock = asyncio.Lock()
        # Unique worker ID for this instance
        self.worker_id = str(uuid.uuid4())[:8]
        # Redis pubsub listener task
        self._pubsub_task: Optional[asyncio.Task] = None
        self._pubsub_started = False
        
        logger.info(f"[WS-MANAGER] ConnectionManager initialized, worker_id={self.worker_id}")
    
    async def start_pubsub_listener(self):
        """Start listening for Redis pub/sub messages"""
        if self._pubsub_started:
            logger.debug(f"[WS-MANAGER] Pub/sub listener already started, worker_id={self.worker_id}")
            return
        self._pubsub_started = True
        self._pubsub_task = asyncio.create_task(self._listen_for_messages())
        logger.info(f"[WS-MANAGER] Started Redis pub/sub listener, worker_id={self.worker_id}")
        # Give the listener a moment to subscribe
        await asyncio.sleep(0.1)
    
    async def _listen_for_messages(self):
        """Listen for messages from other workers via Redis pub/sub"""
        try:
            redis = get_redis()
            if not redis:
                logger.error(f"[WS-PUBSUB] Redis client not available, worker_id={self.worker_id}")
                return
                
            pubsub = redis.pubsub()
            await pubsub.subscribe(EXTERNAL_TASK_WS_CHANNEL)
            logger.info(f"[WS-PUBSUB] *** SUBSCRIBED *** to channel {EXTERNAL_TASK_WS_CHANNEL}, worker_id={self.worker_id}")
            
            # Publish a test message to verify the channel is working
            test_data = json.dumps({"worker_id": self.worker_id, "type": "subscription_test"})
            num_subs = await redis.publish(EXTERNAL_TASK_WS_CHANNEL, test_data)
            logger.info(f"[WS-PUBSUB] Test publish result: {num_subs} subscribers received it, worker_id={self.worker_id}")
            
            # Track last message time for heartbeat logging
            message_count = 0
            
            async for raw_message in pubsub.listen():
                message_count += 1
                logger.debug(f"[WS-PUBSUB] Raw message #{message_count}, type={raw_message.get('type')}, worker_id={self.worker_id}")
                if raw_message["type"] != "message":
                    continue
                
                try:
                    logger.debug(f"[WS-PUBSUB] Received raw message: {raw_message['data'][:100]}..., worker_id={self.worker_id}")
                    data = json.loads(raw_message["data"])
                    
                    # Skip messages from this worker
                    source_worker = data.get("worker_id")
                    if source_worker == self.worker_id:
                        logger.debug(f"[WS-PUBSUB] Skipping own message, worker_id={self.worker_id}")
                        continue
                    
                    task_token = data.get("task_token")
                    target = data.get("target")  # "shell" or "external_app"
                    message = data.get("message")
                    
                    if not task_token or not target or not message:
                        logger.warning(f"[WS-PUBSUB] Invalid message format: {data}")
                        continue
                    
                    logger.info(f"[WS-PUBSUB] Processing cross-worker message: type={message.get('type')}, target={target}, task={task_token[:8]}, from_worker={source_worker}, my_worker={self.worker_id}")
                    
                    # Check if we have this connection locally
                    async with self._lock:
                        has_connection = task_token in self.active_connections and target in self.active_connections.get(task_token, {})
                        logger.info(f"[WS-PUBSUB] Local connection check: task={task_token[:8]}, target={target}, has_connection={has_connection}, my_connections={list(self.active_connections.keys())}")
                    
                    # Try to deliver locally
                    delivered = await self._deliver_local(task_token, target, message)
                    logger.info(f"[WS-PUBSUB] Delivery result: delivered={delivered}, type={message.get('type')}, target={target}, task={task_token[:8]}...")
                    
                except Exception as e:
                    logger.error(f"[WS-PUBSUB] Error processing message: {e}", exc_info=True)
                    
        except asyncio.CancelledError:
            logger.info(f"[WS-MANAGER] Pub/sub listener cancelled, worker_id={self.worker_id}")
        except Exception as e:
            logger.error(f"[WS-PUBSUB] Listener error: {e}", exc_info=True)
            # Restart listener after a delay
            await asyncio.sleep(1)
            self._pubsub_started = False
            await self.start_pubsub_listener()
    
    async def _deliver_local(self, task_token: str, target: str, message: dict) -> bool:
        """Try to deliver a message to a local connection"""
        ws = None
        async with self._lock:
            if task_token not in self.active_connections:
                logger.debug(f"[WS-LOCAL] Task {task_token[:8]} not in active_connections")
                return False
            
            ws = self.active_connections[task_token].get(target)
            if not ws:
                logger.debug(f"[WS-LOCAL] Target {target} not found for task {task_token[:8]}")
                return False
        
        # Send outside the lock to avoid blocking
        try:
            await ws.send_json(message)
            logger.debug(f"[WS-LOCAL] Delivered to {target} for task {task_token[:8]}: type={message.get('type')}")
            return True
        except Exception as e:
            logger.error(f"[WS-LOCAL] Failed to deliver to {target}: {e}")
            return False
    
    async def _publish_to_redis(self, task_token: str, target: str, message: dict):
        """Publish a message to Redis for other workers"""
        try:
            redis = get_redis()
            if not redis:
                logger.error(f"[WS-PUBSUB] Redis client not available for publishing")
                return
            data = json.dumps({
                "worker_id": self.worker_id,
                "task_token": task_token,
                "target": target,
                "message": message,
            })
            num_subscribers = await redis.publish(EXTERNAL_TASK_WS_CHANNEL, data)
            logger.info(f"[WS-PUBSUB] Published message: type={message.get('type')}, target={target}, task={task_token[:8]}, subscribers={num_subscribers}, worker_id={self.worker_id}")
        except Exception as e:
            logger.error(f"[WS-PUBSUB] Failed to publish: {e}", exc_info=True)
    
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
        
        # Ensure pub/sub listener is running
        await self.start_pubsub_listener()
        
        logger.info(f"[WS-CONNECT] {client_type} connected for task {task_token[:8]}..., worker_id={self.worker_id}")
    
    async def disconnect(self, task_token: str, client_type: str):
        """Remove a connection"""
        async with self._lock:
            if task_token in self.active_connections:
                if client_type in self.active_connections[task_token]:
                    del self.active_connections[task_token][client_type]
                
                # Clean up if no connections left
                if not self.active_connections[task_token]:
                    del self.active_connections[task_token]
        
        logger.info(f"[WS-DISCONNECT] {client_type} disconnected for task {task_token[:8]}..., worker_id={self.worker_id}")
    
    async def send_to_shell(self, task_token: str, message: dict):
        """Send message to the shell client (tries local first, then pub/sub)"""
        # Try local delivery first
        local_success = await self._deliver_local(task_token, "shell", message)
        
        if local_success:
            logger.info(f"[WS-DEBUG] send_to_shell SUCCESS (local): type={message.get('type')} for task {task_token[:8]}...")
            return True
        
        # Not found locally, publish to Redis for other workers
        logger.info(f"[WS-DEBUG] send_to_shell: shell not local, publishing to Redis for task {task_token[:8]}...")
        await self._publish_to_redis(task_token, "shell", message)
        
        # We don't know if another worker delivered it, but we've done our best
        # Return True to indicate the message was published
        return True
    
    async def send_to_external_app(self, task_token: str, message: dict):
        """Send message to the external app client (tries local first, then pub/sub)"""
        # Try local delivery first
        local_success = await self._deliver_local(task_token, "external_app", message)
        
        if local_success:
            logger.debug(f"[WS-DEBUG] send_to_external_app SUCCESS (local): type={message.get('type')} for task {task_token[:8]}...")
            return True
        
        # Not found locally, publish to Redis for other workers
        logger.info(f"[WS-DEBUG] send_to_external_app: external_app not local, publishing to Redis for task {task_token[:8]}...")
        await self._publish_to_redis(task_token, "external_app", message)
        return True
    
    def is_shell_connected(self, task_token: str) -> bool:
        """Check if shell is connected (local only - can't check other workers)"""
        return (
            task_token in self.active_connections and
            "shell" in self.active_connections[task_token]
        )
    
    def is_external_app_connected(self, task_token: str) -> bool:
        """Check if external app is connected (local only - can't check other workers)"""
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
    logger.info(f"[WS-DEBUG] New WebSocket connection attempt for task {task_token[:8]}...")
    
    # Validate task token
    task_data = await get_task_by_token(task_token)
    if not task_data:
        logger.warning(f"[WS-DEBUG] Task not found or expired: {task_token[:8]}...")
        await websocket.close(code=4004, reason="Task not found or expired")
        return
    
    logger.info(f"[WS-DEBUG] Task found, status={task_data.get('status')}, accepting connection...")
    
    # Accept connection (we'll determine client type from first message)
    await websocket.accept()
    logger.info(f"[WS-DEBUG] Connection accepted for task {task_token[:8]}...")
    
    client_type = None
    
    try:
        # Wait for client identification message
        logger.info(f"[WS-DEBUG] Waiting for identification message from task {task_token[:8]}...")
        try:
            first_message = await asyncio.wait_for(
                websocket.receive_json(),
                timeout=10.0  # 10 second timeout for identification
            )
        except json.JSONDecodeError as e:
            logger.error(f"[WS-DEBUG] Invalid JSON in first message for task {task_token[:8]}: {e}")
            await websocket.close(code=4003, reason="Invalid JSON message")
            return
        
        # Determine client type from message
        msg_type = first_message.get("type", "")
        logger.info(f"[WS-DEBUG] Received identification: type='{msg_type}', full_message={first_message} for task {task_token[:8]}...")
        
        if msg_type == "shell_connect":
            client_type = "shell"
            logger.info(f"[WS-DEBUG] Identified as SHELL for task {task_token[:8]}...")
            await handle_shell_connection(websocket, task_token, task_data, first_message)
        elif msg_type == "ready" or msg_type == "external_app_connect":
            client_type = "external_app"
            logger.info(f"[WS-DEBUG] Identified as EXTERNAL_APP for task {task_token[:8]}...")
            await handle_external_app_connection(websocket, task_token, task_data, first_message)
        else:
            logger.warning(f"[WS-DEBUG] Invalid identification type: '{msg_type}' for task {task_token[:8]}...")
            await websocket.close(code=4000, reason=f"Invalid client identification: {msg_type}")
            return
            
    except asyncio.TimeoutError:
        logger.warning(f"[WS-DEBUG] Timeout waiting for identification for task {task_token[:8]}...")
        await websocket.close(code=4001, reason="Connection timeout - no identification message")
    except WebSocketDisconnect:
        logger.info(f"[WS-DEBUG] WebSocket disconnected during handshake for task {task_token[:8]}...")
    except Exception as e:
        logger.error(f"[WS-DEBUG] WebSocket error for task {task_token[:8]}: {e}", exc_info=True)
        try:
            await websocket.close(code=4002, reason=str(e))
        except Exception:
            pass
    finally:
        logger.info(f"[WS-DEBUG] Connection cleanup: client_type={client_type} for task {task_token[:8]}...")
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
    logger.info(f"[WS-DEBUG] handle_shell_connection started for task {task_token[:8]}...")
    
    # Register connection
    # Note: websocket already accepted, need to re-register properly
    async with manager._lock:
        if task_token not in manager.active_connections:
            manager.active_connections[task_token] = {}
        manager.active_connections[task_token]["shell"] = websocket
        # Log current connections for this task
        connections = list(manager.active_connections[task_token].keys())
        logger.info(f"[WS-DEBUG] Registered shell, current connections: {connections} for task {task_token[:8]}, worker_id={manager.worker_id}")
    
    # Start pub/sub listener for cross-worker communication
    await manager.start_pubsub_listener()
    
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
    logger.info(f"[WS-DEBUG] handle_external_app_connection started for task {task_token[:8]}...")
    
    # Register connection
    async with manager._lock:
        if task_token not in manager.active_connections:
            manager.active_connections[task_token] = {}
        manager.active_connections[task_token]["external_app"] = websocket
        # Log current connections for this task
        connections = list(manager.active_connections[task_token].keys())
        logger.info(f"[WS-DEBUG] Registered external_app, current connections: {connections} for task {task_token[:8]}, worker_id={manager.worker_id}")
    
    # Start pub/sub listener for cross-worker communication
    await manager.start_pubsub_listener()
    
    now = datetime.utcnow()
    
    # Update task data
    await update_task_in_redis(task_token, {
        "external_app_connected": True,
        "status": ExternalTaskStatus.STARTED.value,
        "started_at": now.isoformat(),
    })
    logger.info(f"[WS-DEBUG] Updated Redis: external_app_connected=True for task {task_token[:8]}...")
    
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
    logger.info(f"[WS-DEBUG] Sent INIT to external app for task {task_token[:8]}...")
    
    # Notify shell that external app connected
    shell_notified = await manager.send_to_shell(task_token, {
        "type": WSMessageType.EXTERNAL_APP_CONNECTED.value,
        "timestamp": now.isoformat(),
    })
    logger.info(f"[WS-DEBUG] Notified shell of external_app_connected: success={shell_notified} for task {task_token[:8]}...")
    
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
        
        # IMPORTANT: Persist completion state to MongoDB session data immediately
        # This ensures the completion survives page refreshes before the user clicks "Continue"
        # (similar to how video completion should persist)
        sessions = get_collection("sessions")
        stage_id = task_data["stage_id"]
        session_id = task_data["session_id"]
        
        await sessions.update_one(
            {"session_id": session_id},
            {
                "$set": {
                    f"data.{stage_id}._external_task_completed": True,
                    f"data.{stage_id}._external_task_completion_time": now.isoformat(),
                    f"data.{stage_id}._external_task_data": data,
                    "updated_at": now,
                }
            }
        )
        logger.info(f"[DEBUG] Persisted completion to MongoDB session {session_id}, stage {stage_id}")
        
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



