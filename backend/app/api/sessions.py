"""
Session management API routes (participant-facing)
"""
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, HTTPException, status, Request, Query, BackgroundTasks
from uuid import uuid4
import logging
from pymongo import ReturnDocument

from app.core.database import get_collection, get_db
from app.core.redis_client import get_redis, RedisKeys, RedisTTL
from app.models.session import (
    SessionCreate,
    SessionStartResponse,
    StageSubmission,
    StageSubmitResponse,
    JumpRequest,
    JumpResponse,
    SessionRecoveryResponse,
    SessionStatus,
    StageStatus,
    LockedItems,
)
from app.models.event import EventType
from app.services.session_manager import SessionManager
from app.services.quota_engine import QuotaEngine
from app.services.log_exporter import LogExporter
from app.api.monitoring import update_events_participant_label

logger = logging.getLogger(__name__)
router = APIRouter()


def _build_participant_label_from_identity(
    stage_config: dict,
    submitted_data: dict
) -> str | None:
    """
    Build participant label from participant_identity stage fields.
    Concatenates all fields marked with include_in_label=true using underscores.
    
    Args:
        stage_config: The stage configuration dict
        submitted_data: The submitted form data
    
    Returns:
        The constructed participant label, or None if no label fields have values
    """
    fields = stage_config.get("fields", [])
    label_parts = []
    
    for field in fields:
        # Skip disabled fields
        if not field.get("enabled", True):
            continue
        
        # Only include fields marked for label
        if not field.get("include_in_label", False):
            continue
        
        field_name = field.get("field")
        if not field_name:
            continue
        
        value = submitted_data.get(field_name)
        if value:
            # Convert to string and strip whitespace
            value_str = str(value).strip()
            # Replace spaces with underscores within values
            value_str = value_str.replace(" ", "_")
            if value_str:
                label_parts.append(value_str)
    
    if not label_parts:
        return None
    
    return "_".join(label_parts)


def _format_duration(seconds: float) -> str:
    """Format duration in seconds to human-readable string"""
    if seconds is None:
        return "N/A"
    
    if seconds < 60:
        return f"{int(seconds)}s"
    elif seconds < 3600:
        minutes = int(seconds // 60)
        secs = int(seconds % 60)
        return f"{minutes}m {secs}s"
    else:
        hours = int(seconds // 3600)
        minutes = int((seconds % 3600) // 60)
        return f"{hours}h {minutes}m"


def get_user_id(request: Request) -> str:
    """Get or create persistent user ID from cookie/header"""
    # Check for existing user ID in cookie
    user_id = request.cookies.get("bires_user_id")
    
    if not user_id:
        # Check header (for mobile apps)
        user_id = request.headers.get("X-BIRES-User-ID")
    
    if not user_id:
        # Generate new user ID
        user_id = str(uuid4())
    
    return user_id


@router.post("/start", response_model=SessionStartResponse)
async def start_session(
    session_data: SessionCreate,
    request: Request,
):
    """Start a new experiment session"""
    experiments = get_collection("experiments")
    sessions = get_collection("sessions")
    
    # Get experiment config
    exp_doc = await experiments.find_one({
        "experiment_id": session_data.experiment_id,
        "status": "published"
    })
    
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found or not published"
        )
    
    # Get or create user ID
    user_id = get_user_id(request)
    
    # Check for existing active session
    existing_session = await sessions.find_one({
        "experiment_id": session_data.experiment_id,
        "user_id": user_id,
        "status": SessionStatus.ACTIVE.value
    })
    
    if existing_session:
        # Return existing session state
        session_manager = SessionManager(exp_doc["config"], db=get_db())
        state = await session_manager.get_session_state(existing_session["session_id"])
        
        return SessionStartResponse(
            session_id=existing_session["session_id"],
            experiment_id=session_data.experiment_id,
            current_stage=state["current_stage"],
            visible_stages=state["visible_stages"],
            progress=state["progress"],
            shell_config=exp_doc["config"].get("shell_config"),
            debug_mode=exp_doc["config"].get("meta", {}).get("debug_mode", False),
        )
    
    # Create new session
    session_id = str(uuid4())
    now = datetime.utcnow()
    
    session_manager = SessionManager(exp_doc["config"], db=get_db())
    initial_state = await session_manager.initialize_session(
        session_id=session_id,
        user_id=user_id,
        url_params=session_data.url_params or {},
    )
    
    # Auto-assign participant number (per experiment, atomic operation)
    # Use a counter collection to ensure atomic increment
    counters = get_collection("counters")
    counter_doc = await counters.find_one_and_update(
        {"_id": f"participant_{session_data.experiment_id}"},
        {"$inc": {"seq": 1}},
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    participant_number = counter_doc["seq"]
    
    # Build metadata
    metadata = {
        "user_agent": session_data.user_agent or request.headers.get("user-agent", ""),
        "screen_size": session_data.screen_size,
        "url_params": session_data.url_params or {},
        "ip_address": request.client.host if request.client else None,
        "referrer": request.headers.get("referer", ""),
    }
    
    session_doc = {
        "_id": session_id,
        "session_id": session_id,
        "experiment_id": session_data.experiment_id,
        "user_id": user_id,
        "participant_number": participant_number,
        "participant_label": None,  # Can be set by admin later
        "status": SessionStatus.ACTIVE.value,
        "current_stage_id": initial_state["current_stage_id"],
        "current_substep_index": 0,
        "stage_progress": initial_state["stage_progress"],
        "visible_stages": initial_state["visible_stage_ids"],
        "completed_stages": [],
        "data": {},
        "metadata": metadata,
        "created_at": now,
        "updated_at": now,
        # Assignments for balanced/weighted distribution and pick_count selections
        "assignments": initial_state.get("assignments", {}),
        "randomization_seed": initial_state.get("randomization_seed"),
    }
    
    await sessions.insert_one(session_doc)
    
    # Store session state in Redis for fast access
    redis = get_redis()
    await redis.setex(
        RedisKeys.session_state(session_id),
        RedisTTL.SESSION,
        session_manager.serialize_state(initial_state)
    )
    
    return SessionStartResponse(
        session_id=session_id,
        experiment_id=session_data.experiment_id,
        current_stage=initial_state["current_stage"],
        visible_stages=initial_state["visible_stages"],
        progress=initial_state["progress"],
        shell_config=exp_doc["config"].get("shell_config"),
        debug_mode=exp_doc["config"].get("meta", {}).get("debug_mode", False),
    )


@router.post("/{session_id}/submit", response_model=StageSubmitResponse)
async def submit_stage(
    session_id: str,
    submission: StageSubmission,
    background_tasks: BackgroundTasks,
):
    """Submit stage data and get next stage"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    
    # Get session
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    if session_doc["status"] != SessionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session is {session_doc['status']}"
        )
    
    # Validate stage ID matches current stage
    if submission.stage_id != session_doc["current_stage_id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Submitted stage does not match current stage"
        )
    
    # Get experiment config
    exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Experiment configuration not found"
        )
    
    session_manager = SessionManager(exp_doc["config"], db=get_db())
    
    # Check quota if applicable
    quota_engine = QuotaEngine()
    stage_config = session_manager.get_stage_config(submission.stage_id)
    
    if stage_config and stage_config.get("quota"):
        can_complete = await quota_engine.try_complete(
            experiment_id=session_doc["experiment_id"],
            stage_id=submission.stage_id,
            session_id=session_id
        )
        if not can_complete:
            # Quota exceeded, handle according to strategy
            quota_strategy = stage_config["quota"].get("strategy", "skip_if_full")
            if quota_strategy == "skip_if_full":
                fallback = stage_config["quota"].get("fallback_stage")
                # Force skip to fallback or next stage
                submission.data["_quota_skipped"] = True
    
    # Process submission
    try:
        result = await session_manager.submit_stage(
            session_id=session_id,
            session_data=session_doc,
            stage_id=submission.stage_id,
            data=submission.data,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    # Update session in database
    now = datetime.utcnow()
    
    update_data = {
        "current_stage_id": result["next_stage_id"],
        "current_substep_index": 0,
        "stage_progress": result["stage_progress"],
        "visible_stages": result["visible_stage_ids"],
        "completed_stages": result["completed_stage_ids"],
        # Hierarchical completion tracking for navigation locks
        "completed_phases": result.get("completed_phases", []),
        "completed_blocks": result.get("completed_blocks", {}),
        # Assignments including pick_count selections
        "assignments": result.get("assignments", {}),
        f"data.{submission.stage_id}": submission.data,
        "updated_at": now,
    }
    
    if result["is_complete"]:
        update_data["status"] = SessionStatus.COMPLETED.value
        update_data["completed_at"] = now
    
    # Handle participant_identity stage - update participant label
    if stage_config and stage_config.get("type") == "participant_identity":
        participant_label = _build_participant_label_from_identity(stage_config, submission.data)
        if participant_label:
            update_data["participant_label"] = participant_label
            # Queue background task to update all events for this session
            background_tasks.add_task(update_events_participant_label, session_id, participant_label)
            logger.info(f"Session {session_id} participant label updated to: {participant_label}")
    
    await sessions.update_one(
        {"session_id": session_id},
        {"$set": update_data}
    )
    
    # Log session_complete event when experiment is finished
    if result["is_complete"]:
        events_collection = get_collection("events")
        
        # Calculate session duration and statistics
        started_at = session_doc.get("created_at")
        duration_seconds = (now - started_at).total_seconds() if started_at else None
        
        # Calculate stage-level timing statistics
        stage_timings = {}
        stage_progress = result.get("stage_progress", {})
        for stage_id, progress in stage_progress.items():
            if progress.get("started_at") and progress.get("completed_at"):
                try:
                    started = progress["started_at"]
                    completed = progress["completed_at"]
                    # Handle both datetime objects and ISO strings
                    if isinstance(started, str):
                        started = datetime.fromisoformat(started.replace('Z', '+00:00'))
                    if isinstance(completed, str):
                        completed = datetime.fromisoformat(completed.replace('Z', '+00:00'))
                    stage_duration = (completed - started).total_seconds()
                    stage_timings[stage_id] = round(stage_duration, 2)
                except Exception:
                    pass
        
        # Build completion event payload
        completion_payload = {
            "started_at": started_at.isoformat() if started_at else None,
            "completed_at": now.isoformat(),
            "duration_seconds": round(duration_seconds, 2) if duration_seconds else None,
            "duration_formatted": _format_duration(duration_seconds) if duration_seconds else None,
            "total_stages": len(result.get("visible_stage_ids", [])),
            "completed_stages_count": len(result.get("completed_stage_ids", [])),
            "completed_stage_ids": result.get("completed_stage_ids", []),
            "stage_timings": stage_timings,
            "metadata": session_doc.get("metadata", {}),
        }
        
        # Create session_complete event
        event_id = str(uuid4())
        event_doc = {
            "_id": event_id,
            "event_id": event_id,
            "idempotency_key": f"session_complete_{session_id}",
            "session_id": session_id,
            "experiment_id": session_doc["experiment_id"],
            "user_id": session_doc["user_id"],
            "participant_number": session_doc.get("participant_number", 0),
            "participant_label": session_doc.get("participant_label"),
            "event_type": EventType.SESSION_END.value,
            "stage_id": submission.stage_id,  # Last stage
            "block_id": None,
            "payload": completion_payload,
            "metadata": {},
            "client_timestamp": now,
            "server_timestamp": now,
        }
        
        await events_collection.insert_one(event_doc)
        
        # Queue S3 backup
        background_tasks.add_task(
            LogExporter.export_event_to_s3,
            event_doc
        )
        
        logger.info(f"Session {session_id} completed in {_format_duration(duration_seconds)}")
    
    # Update Redis state
    redis = get_redis()
    await redis.setex(
        RedisKeys.session_state(session_id),
        RedisTTL.SESSION,
        session_manager.serialize_state(result)
    )
    
    # Build locked items response
    locked_items_data = result.get("locked_items", {})
    locked_items = LockedItems(
        phases=locked_items_data.get("phases", []),
        stages=locked_items_data.get("stages", []),
        blocks=locked_items_data.get("blocks", []),
        tasks=locked_items_data.get("tasks", []),
    )
    
    return StageSubmitResponse(
        session_id=session_id,
        next_stage=result.get("next_stage"),
        visible_stages=result["visible_stages"],
        completed_stage_ids=result["completed_stage_ids"],
        progress=result["progress"],
        is_complete=result["is_complete"],
        locked_items=locked_items,
    )


@router.get("/{session_id}/state", response_model=SessionRecoveryResponse)
async def get_session_state(session_id: str):
    """Get current session state (for recovery after disconnect)"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    session_status = SessionStatus(session_doc["status"])
    
    # Get experiment config for shell_config
    exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
    shell_config = exp_doc["config"].get("shell_config") if exp_doc else None
    
    # If session is completed, return minimal response
    if session_status == SessionStatus.COMPLETED:
        return SessionRecoveryResponse(
            session_id=session_id,
            status=session_status,
            current_stage=None,
            visible_stages=[],
            completed_stage_ids=session_doc.get("completed_stages", []),
            progress={"current": 100, "total": 100, "percentage": 100},
            data=session_doc.get("data", {}),
            shell_config=shell_config,
            debug_mode=exp_doc["config"].get("meta", {}).get("debug_mode", False) if exp_doc else False,
        )
    
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Experiment configuration not found"
        )
    
    session_manager = SessionManager(exp_doc["config"], db=get_db())
    state = await session_manager.get_session_state(session_id, session_doc)
    
    # Build locked items response
    locked_items_data = state.get("locked_items", {})
    state_locked_items = LockedItems(
        phases=locked_items_data.get("phases", []),
        stages=locked_items_data.get("stages", []),
        blocks=locked_items_data.get("blocks", []),
        tasks=locked_items_data.get("tasks", []),
    )
    
    return SessionRecoveryResponse(
        session_id=session_id,
        status=session_status,
        current_stage=state["current_stage"],
        visible_stages=state["visible_stages"],
        completed_stage_ids=state["completed_stage_ids"],
        progress=state["progress"],
        data=session_doc.get("data", {}),
        shell_config=exp_doc["config"].get("shell_config"),
        locked_items=state_locked_items,
        debug_mode=exp_doc["config"].get("meta", {}).get("debug_mode", False),
    )


@router.post("/{session_id}/jump", response_model=JumpResponse)
async def jump_to_stage(
    session_id: str,
    jump_request: JumpRequest,
):
    """Jump to a reference stage or completed stage"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    if session_doc["status"] != SessionStatus.ACTIVE.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Session is {session_doc['status']}"
        )
    
    exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Experiment configuration not found"
        )
    
    session_manager = SessionManager(exp_doc["config"], db=get_db())
    
    try:
        result = await session_manager.jump_to_stage(
            session_id=session_id,
            session_data=session_doc,
            target_stage_id=jump_request.target_stage_id,
        )
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    # Update session with new current_stage_id and any invalidated data
    update_data = {
        "current_stage_id": result["current_stage_id"],
        "updated_at": datetime.utcnow(),
    }
    
    if result.get("invalidated_stages"):
        update_data["stage_progress"] = result["stage_progress"]
        update_data["completed_stages"] = result["completed_stage_ids"]
    
    await sessions.update_one(
        {"session_id": session_id},
        {
            "$set": update_data,
            "$unset": {
                f"data.{stage_id}": ""
                for stage_id in (result.get("invalidated_stages") or [])
            }
        }
    )
    
    # Update Redis state - refetch updated session and rebuild state
    updated_session_doc = await sessions.find_one({"session_id": session_id})
    if updated_session_doc:
        redis = get_redis()
        state = await session_manager.get_session_state(session_id, updated_session_doc)
        await redis.setex(
            RedisKeys.session_state(session_id),
            RedisTTL.SESSION,
            session_manager.serialize_state(state)
        )
    
    # Build locked items response
    locked_items_data = result.get("locked_items", {})
    jump_locked_items = LockedItems(
        phases=locked_items_data.get("phases", []),
        stages=locked_items_data.get("stages", []),
        blocks=locked_items_data.get("blocks", []),
        tasks=locked_items_data.get("tasks", []),
    )
    
    return JumpResponse(
        session_id=session_id,
        current_stage=result["current_stage"],
        return_stage_id=result["return_stage_id"],
        is_reference=result["is_reference"],
        invalidated_stages=result.get("invalidated_stages"),
        locked_items=jump_locked_items,
    )


@router.post("/{session_id}/return")
async def return_from_jump(session_id: str):
    """Return to the main flow after viewing a reference stage"""
    sessions = get_collection("sessions")
    
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Get return stage from Redis
    redis = get_redis()
    return_stage_id = await redis.get(f"jump_return:{session_id}")
    
    if not return_stage_id:
        # Already at main flow
        return {"message": "Already at main flow", "current_stage_id": session_doc["current_stage_id"]}
    
    # Clear the jump return marker
    await redis.delete(f"jump_return:{session_id}")
    
    # Update session
    await sessions.update_one(
        {"session_id": session_id},
        {"$set": {
            "current_stage_id": return_stage_id,
            "updated_at": datetime.utcnow(),
        }}
    )
    
    return {
        "message": "Returned to main flow",
        "current_stage_id": return_stage_id
    }


@router.post("/{session_id}/abandon")
async def abandon_session(session_id: str):
    """Mark session as abandoned"""
    sessions = get_collection("sessions")
    
    result = await sessions.update_one(
        {"session_id": session_id, "status": SessionStatus.ACTIVE.value},
        {"$set": {
            "status": SessionStatus.ABANDONED.value,
            "updated_at": datetime.utcnow(),
        }}
    )
    
    if result.matched_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Active session not found"
        )
    
    return {"message": "Session abandoned"}

