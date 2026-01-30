"""
External Task API routes for task initialization and status
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, status, Query
from uuid import uuid4
import secrets
import logging
import json

from app.core.database import get_collection
from app.core.redis_client import get_redis, RedisTTL
from app.models.external_task import (
    ExternalTaskStatus,
    ExternalTaskInitRequest,
    ExternalTaskInitResponse,
    ExternalTaskStatusResponse,
    ExternalTaskInDB,
    SendCommandRequest,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Redis key prefixes for external tasks
EXTERNAL_TASK_PREFIX = "external_task:"
EXTERNAL_TASK_TOKEN_PREFIX = "external_task_token:"

# Token expiration (24 hours by default)
EXTERNAL_TASK_TOKEN_TTL = 86400


def generate_task_token() -> str:
    """Generate a secure task token"""
    return secrets.token_urlsafe(32)


async def get_task_by_token(task_token: str) -> Optional[dict]:
    """Get external task data from Redis by token"""
    redis = get_redis()
    task_data = await redis.get(f"{EXTERNAL_TASK_TOKEN_PREFIX}{task_token}")
    if task_data:
        return json.loads(task_data)
    return None


async def save_task_to_redis(task_data: dict, ttl: int = EXTERNAL_TASK_TOKEN_TTL):
    """Save external task data to Redis"""
    redis = get_redis()
    task_token = task_data["task_token"]
    await redis.setex(
        f"{EXTERNAL_TASK_TOKEN_PREFIX}{task_token}",
        ttl,
        json.dumps(task_data, default=str)
    )


async def update_task_in_redis(task_token: str, updates: dict):
    """Update external task data in Redis"""
    task_data = await get_task_by_token(task_token)
    if task_data:
        task_data.update(updates)
        await save_task_to_redis(task_data)
        return task_data
    return None


@router.post("/init", response_model=ExternalTaskInitResponse)
async def init_external_task(
    session_id: str,
    request: ExternalTaskInitRequest,
    platform_host: Optional[str] = Query(None, description="Platform host for WebSocket connection (passed to external app)"),
):
    """
    Initialize an external task for a session.
    Returns a task token and WebSocket URL for real-time communication.
    """
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    
    # Validate session
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    if session_doc["status"] != "active":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session is {session_doc['status']}"
        )
    
    # Get experiment config for stage validation
    exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Experiment configuration not found"
        )
    
    # Generate task token
    task_token = generate_task_token()
    now = datetime.utcnow()
    
    # Build target URL with task_token
    target_url = request.target_url
    separator = "&" if "?" in target_url else "?"
    target_url_with_token = f"{target_url}{separator}task_token={task_token}"
    
    # Add optional URL params
    config = request.config or {}
    if config.get("pass_session_id", True):
        target_url_with_token += f"&session_id={session_id}"
    if config.get("pass_stage_id", True):
        target_url_with_token += f"&stage_id={request.stage_id}"
    
    # Add custom params
    custom_params = config.get("custom_params", {})
    if custom_params:
        for key, value in custom_params.items():
            # Note: Variable interpolation should be done by the frontend
            target_url_with_token += f"&{key}={value}"
    
    # Add platform_host for cross-domain WebSocket connection
    if platform_host:
        target_url_with_token += f"&platform_host={platform_host}"
    
    # Create task data
    task_data = {
        "_id": str(uuid4()),
        "task_token": task_token,
        "session_id": session_id,
        "experiment_id": session_doc["experiment_id"],
        "stage_id": request.stage_id,
        "user_id": session_doc["user_id"],
        "participant_number": session_doc.get("participant_number", 0),
        "target_url": request.target_url,
        "target_url_with_token": target_url_with_token,
        "config": config,
        "status": ExternalTaskStatus.PENDING.value,
        "progress": 0,
        "current_step": None,
        "data": None,
        "retry_count": 0,
        "shell_connected": False,
        "external_app_connected": False,
        "created_at": now.isoformat(),
        "started_at": None,
        "completed_at": None,
        "expires_at": (now + timedelta(seconds=EXTERNAL_TASK_TOKEN_TTL)).isoformat(),
    }
    
    # Save to Redis
    await save_task_to_redis(task_data)
    
    # Also save a reference in the session for tracking
    await sessions.update_one(
        {"session_id": session_id},
        {
            "$set": {
                f"external_tasks.{request.stage_id}": {
                    "task_token": task_token,
                    "status": ExternalTaskStatus.PENDING.value,
                    "created_at": now,
                }
            }
        }
    )
    
    logger.info(f"Initialized external task {task_token} for session {session_id}, stage {request.stage_id}")
    
    return ExternalTaskInitResponse(
        task_token=task_token,
        target_url=target_url_with_token,
        ws_url=f"/api/ws/external-task/{task_token}",
    )


@router.get("/{task_token}/status", response_model=ExternalTaskStatusResponse)
async def get_external_task_status(task_token: str):
    """Get the current status of an external task"""
    task_data = await get_task_by_token(task_token)
    
    if not task_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or expired"
        )
    
    return ExternalTaskStatusResponse(
        task_token=task_token,
        status=ExternalTaskStatus(task_data["status"]),
        progress=task_data.get("progress", 0),
        current_step=task_data.get("current_step"),
        data=task_data.get("data"),
        started_at=task_data.get("started_at"),
        completed_at=task_data.get("completed_at"),
        retry_count=task_data.get("retry_count", 0),
        external_app_connected=task_data.get("external_app_connected", False),
    )


@router.post("/{task_token}/retry")
async def retry_external_task(task_token: str):
    """Reset the task for retry"""
    task_data = await get_task_by_token(task_token)
    
    if not task_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or expired"
        )
    
    # Check max retries
    config = task_data.get("config", {})
    max_retries = config.get("max_retries", 3)
    current_retries = task_data.get("retry_count", 0)
    
    if max_retries > 0 and current_retries >= max_retries:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum retries ({max_retries}) exceeded"
        )
    
    # Reset task state
    updates = {
        "status": ExternalTaskStatus.PENDING.value,
        "progress": 0,
        "current_step": None,
        "data": None,
        "external_app_connected": False,
        "started_at": None,
        "completed_at": None,
        "retry_count": current_retries + 1,
    }
    
    await update_task_in_redis(task_token, updates)
    
    logger.info(f"Task {task_token} reset for retry (attempt {current_retries + 1})")
    
    return {"status": "ok", "retry_count": current_retries + 1}


@router.post("/{task_token}/manual-complete")
async def manual_complete_task(task_token: str):
    """
    Manually mark task as complete (for 'manual' completion mode).
    Used when user clicks "Mark as Done" button.
    """
    task_data = await get_task_by_token(task_token)
    
    if not task_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or expired"
        )
    
    config = task_data.get("config", {})
    completion_mode = config.get("completion_mode", "required")
    
    if completion_mode not in ["manual", "optional"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Manual completion not allowed for this task"
        )
    
    now = datetime.utcnow()
    updates = {
        "status": ExternalTaskStatus.COMPLETED.value,
        "completed_at": now.isoformat(),
        "data": {"manual_completion": True},
    }
    
    await update_task_in_redis(task_token, updates)
    
    logger.info(f"Task {task_token} manually completed")
    
    return {"status": "completed"}


@router.delete("/{task_token}")
async def cancel_external_task(task_token: str):
    """Cancel an external task"""
    task_data = await get_task_by_token(task_token)
    
    if not task_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Task not found or expired"
        )
    
    updates = {
        "status": ExternalTaskStatus.CANCELLED.value,
    }
    
    await update_task_in_redis(task_token, updates)
    
    logger.info(f"Task {task_token} cancelled")
    
    return {"status": "cancelled"}



