"""
Event logging API routes
"""
from datetime import datetime
from fastapi import APIRouter, HTTPException, status, BackgroundTasks
from uuid import uuid4
import logging

from app.core.database import get_collection
from app.core.redis_client import get_redis, RedisKeys, RedisTTL
from app.models.event import (
    EventCreate,
    EventBatch,
    EventResponse,
    EventBatchResponse,
)
from app.services.log_exporter import LogExporter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("", response_model=EventResponse)
async def log_event(
    event: EventCreate,
    background_tasks: BackgroundTasks,
):
    """Log a single event"""
    redis = get_redis()
    events = get_collection("events")
    sessions = get_collection("sessions")
    
    # Check idempotency key to prevent duplicates
    idem_key = RedisKeys.idempotency(event.idempotency_key)
    if await redis.exists(idem_key):
        return EventResponse(
            event_id=event.idempotency_key,
            status="duplicate_accepted"
        )
    
    # Get session to enrich event with experiment_id and user_id
    session_doc = await sessions.find_one({"session_id": event.session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Create event document
    event_id = str(uuid4())
    now = datetime.utcnow()
    
    event_doc = {
        "_id": event_id,
        "event_id": event_id,
        "idempotency_key": event.idempotency_key,
        "session_id": event.session_id,
        "experiment_id": session_doc["experiment_id"],
        "user_id": session_doc["user_id"],
        "participant_number": session_doc.get("participant_number", 0),
        "participant_label": session_doc.get("participant_label"),
        "event_type": event.event_type.value,
        "stage_id": event.stage_id,
        "block_id": event.block_id,
        "payload": event.payload,
        "metadata": event.metadata.model_dump() if event.metadata else {},
        "client_timestamp": event.timestamp or now,
        "server_timestamp": now,
    }
    
    # Write to MongoDB (primary storage)
    await events.insert_one(event_doc)
    
    # Mark idempotency key as processed
    await redis.setex(idem_key, RedisTTL.IDEMPOTENCY, "1")
    
    # Queue async backup to S3 (non-blocking)
    background_tasks.add_task(
        LogExporter.export_event_to_s3,
        event_doc
    )
    
    return EventResponse(
        event_id=event_id,
        status="accepted"
    )


@router.post("/batch", response_model=EventBatchResponse)
async def log_events_batch(
    batch: EventBatch,
    background_tasks: BackgroundTasks,
):
    """Log multiple events (for offline sync)"""
    logger.info(f"Received batch of {len(batch.events)} events for session {batch.session_id}")
    
    redis = get_redis()
    events_collection = get_collection("events")
    sessions = get_collection("sessions")
    
    # Get session info
    session_doc = await sessions.find_one({"session_id": batch.session_id})
    if not session_doc:
        logger.warning(f"Session not found: {batch.session_id}")
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    accepted = 0
    duplicates = 0
    failed = 0
    
    now = datetime.utcnow()
    events_to_insert = []
    
    for event in batch.events:
        # Check idempotency
        idem_key = RedisKeys.idempotency(event.idempotency_key)
        if await redis.exists(idem_key):
            duplicates += 1
            continue
        
        try:
            event_id = str(uuid4())
            
            event_doc = {
                "_id": event_id,
                "event_id": event_id,
                "idempotency_key": event.idempotency_key,
                "session_id": batch.session_id,
                "experiment_id": session_doc["experiment_id"],
                "user_id": session_doc["user_id"],
                "participant_number": session_doc.get("participant_number", 0),
                "participant_label": session_doc.get("participant_label"),
                "event_type": event.event_type.value,
                "stage_id": event.stage_id,
                "block_id": event.block_id,
                "payload": event.payload,
                "metadata": event.metadata.model_dump() if event.metadata else {},
                "client_timestamp": event.timestamp or now,
                "server_timestamp": now,
            }
            
            events_to_insert.append(event_doc)
            
            # Mark idempotency key
            await redis.setex(idem_key, RedisTTL.IDEMPOTENCY, "1")
            
            accepted += 1
            
        except Exception as e:
            logger.error(f"Failed to process event: {e}")
            failed += 1
    
    # Bulk insert
    if events_to_insert:
        await events_collection.insert_many(events_to_insert)
        logger.info(f"Inserted {len(events_to_insert)} events for session {batch.session_id}")
        
        # Queue async backup
        background_tasks.add_task(
            LogExporter.export_events_batch_to_s3,
            events_to_insert
        )
    
    # Return authoritative session state for reconciliation
    session_state = None
    if session_doc:
        session_state = {
            "current_stage_id": session_doc["current_stage_id"],
            "completed_stages": session_doc["completed_stages"],
            "status": session_doc["status"],
        }
    
    logger.info(f"Batch result: accepted={accepted}, duplicates={duplicates}, failed={failed}")
    
    return EventBatchResponse(
        accepted=accepted,
        duplicates=duplicates,
        failed=failed,
        session_state=session_state,
    )


@router.get("/{session_id}")
async def get_session_events(
    session_id: str,
    skip: int = 0,
    limit: int = 100,
):
    """Get all events for a session"""
    events = get_collection("events")
    
    cursor = events.find(
        {"session_id": session_id}
    ).sort("server_timestamp", 1).skip(skip).limit(limit)
    
    result = []
    async for event_doc in cursor:
        result.append({
            "event_id": event_doc["event_id"],
            "event_type": event_doc["event_type"],
            "stage_id": event_doc["stage_id"],
            "block_id": event_doc.get("block_id"),
            "payload": event_doc["payload"],
            "client_timestamp": event_doc["client_timestamp"],
            "server_timestamp": event_doc["server_timestamp"],
        })
    
    return {"events": result, "count": len(result)}

