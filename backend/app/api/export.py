"""
Data export API routes
"""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, status, Depends, Query, BackgroundTasks
from fastapi.responses import StreamingResponse
import csv
import io
import json
import logging

from app.core.database import get_collection
from app.core.security import get_current_user, require_researcher
from app.models.user import UserInDB, UserRole
from app.services.data_exporter import DataExporter

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/{experiment_id}/csv")
async def export_csv(
    experiment_id: str,
    format: str = Query("wide", regex="^(wide|long)$"),
    stages: Optional[str] = Query(None, description="Comma-separated stage IDs to include"),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: UserInDB = Depends(require_researcher),
):
    """Export experiment data as CSV"""
    experiments = get_collection("experiments")
    sessions = get_collection("sessions")
    
    # Verify experiment access
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Build query
    query = {"experiment_id": experiment_id, "status": "completed"}
    
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    # Parse stage filter
    stage_filter = stages.split(",") if stages else None
    
    # Get sessions
    cursor = sessions.find(query).sort("created_at", 1)
    session_docs = await cursor.to_list(length=None)
    
    if not session_docs:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No completed sessions found"
        )
    
    # Generate CSV
    exporter = DataExporter(exp_doc["config"])
    
    if format == "wide":
        csv_content = exporter.to_wide_csv(session_docs, stage_filter)
    else:
        csv_content = exporter.to_long_csv(session_docs, stage_filter)
    
    filename = f"{experiment_id}_{format}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.csv"
    
    return StreamingResponse(
        io.BytesIO(csv_content.encode("utf-8")),
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.get("/{experiment_id}/json")
async def export_json(
    experiment_id: str,
    include_events: bool = Query(False),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: UserInDB = Depends(require_researcher),
):
    """Export experiment data as JSON"""
    experiments = get_collection("experiments")
    sessions = get_collection("sessions")
    events = get_collection("events")
    
    # Verify experiment access
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Build query
    query = {"experiment_id": experiment_id}
    
    if start_date:
        query["created_at"] = {"$gte": start_date}
    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}
    
    # Get sessions
    cursor = sessions.find(query).sort("created_at", 1)
    session_docs = await cursor.to_list(length=None)
    
    result = {
        "experiment_id": experiment_id,
        "experiment_name": exp_doc["name"],
        "exported_at": datetime.utcnow().isoformat(),
        "session_count": len(session_docs),
        "sessions": []
    }
    
    for session_doc in session_docs:
        session_data = {
            "session_id": session_doc["session_id"],
            "user_id": session_doc["user_id"],
            "status": session_doc["status"],
            "data": session_doc.get("data", {}),
            "metadata": session_doc.get("metadata", {}),
            "created_at": session_doc["created_at"].isoformat(),
            "completed_at": session_doc.get("completed_at", "").isoformat() if session_doc.get("completed_at") else None,
        }
        
        if include_events:
            event_cursor = events.find(
                {"session_id": session_doc["session_id"]}
            ).sort("server_timestamp", 1)
            session_events = await event_cursor.to_list(length=None)
            
            session_data["events"] = [
                {
                    "event_type": e["event_type"],
                    "stage_id": e["stage_id"],
                    "block_id": e.get("block_id"),
                    "payload": e["payload"],
                    "client_timestamp": e["client_timestamp"].isoformat(),
                    "server_timestamp": e["server_timestamp"].isoformat(),
                }
                for e in session_events
            ]
        
        result["sessions"].append(session_data)
    
    filename = f"{experiment_id}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
    
    return StreamingResponse(
        io.BytesIO(json.dumps(result, indent=2).encode("utf-8")),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"'
        }
    )


@router.get("/{experiment_id}/stats")
async def get_experiment_stats(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Get experiment statistics"""
    experiments = get_collection("experiments")
    sessions = get_collection("sessions")
    
    # Verify experiment access
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Aggregate statistics
    pipeline = [
        {"$match": {"experiment_id": experiment_id}},
        {"$group": {
            "_id": "$status",
            "count": {"$sum": 1}
        }}
    ]
    
    status_counts = {}
    async for doc in sessions.aggregate(pipeline):
        status_counts[doc["_id"]] = doc["count"]
    
    total = sum(status_counts.values())
    completed = status_counts.get("completed", 0)
    
    # Get completion rate by stage
    stage_pipeline = [
        {"$match": {"experiment_id": experiment_id}},
        {"$unwind": "$completed_stages"},
        {"$group": {
            "_id": "$completed_stages",
            "count": {"$sum": 1}
        }}
    ]
    
    stage_completions = {}
    async for doc in sessions.aggregate(stage_pipeline):
        stage_completions[doc["_id"]] = doc["count"]
    
    return {
        "experiment_id": experiment_id,
        "total_sessions": total,
        "status_breakdown": status_counts,
        "completion_rate": (completed / total * 100) if total > 0 else 0,
        "stage_completions": stage_completions,
    }


@router.get("/{experiment_id}/events")
async def export_events(
    experiment_id: str,
    event_types: Optional[str] = Query(None, description="Comma-separated event types"),
    stage_id: Optional[str] = None,
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    limit: int = Query(10000, ge=1, le=100000),
    current_user: UserInDB = Depends(require_researcher),
):
    """Export raw events as JSON"""
    experiments = get_collection("experiments")
    events = get_collection("events")
    
    # Verify experiment access
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Build query
    query = {"experiment_id": experiment_id}
    
    if event_types:
        query["event_type"] = {"$in": event_types.split(",")}
    
    if stage_id:
        query["stage_id"] = stage_id
    
    if start_date:
        query["server_timestamp"] = {"$gte": start_date}
    if end_date:
        if "server_timestamp" in query:
            query["server_timestamp"]["$lte"] = end_date
        else:
            query["server_timestamp"] = {"$lte": end_date}
    
    cursor = events.find(query).sort("server_timestamp", 1).limit(limit)
    event_docs = await cursor.to_list(length=limit)
    
    result = [
        {
            "event_id": e["event_id"],
            "session_id": e["session_id"],
            "user_id": e["user_id"],
            "event_type": e["event_type"],
            "stage_id": e["stage_id"],
            "block_id": e.get("block_id"),
            "payload": e["payload"],
            "client_timestamp": e["client_timestamp"].isoformat(),
            "server_timestamp": e["server_timestamp"].isoformat(),
        }
        for e in event_docs
    ]
    
    return {
        "experiment_id": experiment_id,
        "event_count": len(result),
        "events": result,
    }



