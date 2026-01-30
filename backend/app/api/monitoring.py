"""
Session monitoring API routes (admin-facing)
"""
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, status, Depends, Query, BackgroundTasks
from pydantic import BaseModel
import logging

from app.core.database import get_collection
from app.core.security import get_current_user, require_researcher
from app.models.user import UserInDB, UserRole
from app.models.session import (
    SessionStatus,
    SessionListItem,
    SessionListResponse,
    SessionStats,
    ExperimentSessionStats,
    DailySessionData,
    SessionsOverTimeResponse,
)


class LiveEvent(BaseModel):
    """Live event for real-time monitoring"""
    event_id: str
    session_id: str
    user_id: str
    participant_number: int = 0  # Human-readable participant number
    participant_label: Optional[str] = None  # Custom label set by admin
    event_type: str
    stage_id: str
    block_id: Optional[str] = None
    payload: Dict[str, Any]
    client_timestamp: datetime
    server_timestamp: datetime


class LiveEventsResponse(BaseModel):
    """Response for live events endpoint"""
    events: List[LiveEvent]
    total: int
    last_timestamp: Optional[datetime] = None


class BlockStatistics(BaseModel):
    """Statistics for a single block/question"""
    block_id: str
    block_type: str
    response_count: int
    # For numeric responses
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    avg_value: Optional[float] = None
    median_value: Optional[float] = None
    # For categorical responses
    value_distribution: Optional[Dict[str, int]] = None


class StageStatistics(BaseModel):
    """Statistics for a single stage"""
    stage_id: str
    stage_label: Optional[str] = None
    view_count: int
    completion_count: int
    avg_time_seconds: Optional[float] = None
    blocks: List[BlockStatistics] = []


class ExperimentLiveStats(BaseModel):
    """Live statistics for an experiment"""
    experiment_id: str
    experiment_name: str
    total_sessions: int
    active_sessions: int
    completed_sessions: int
    abandoned_sessions: int
    completion_rate: float
    stages: List[StageStatistics] = []
    updated_at: datetime


class UpdateParticipantLabelRequest(BaseModel):
    """Request to update participant label"""
    participant_label: Optional[str] = None  # Set to None to clear label


class UpdateParticipantLabelResponse(BaseModel):
    """Response after updating participant label"""
    session_id: str
    participant_number: int
    participant_label: Optional[str]
    events_updated: int  # Number of events updated retroactively


logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("/live/test")
async def test_live_endpoint():
    """Simple test endpoint to verify monitoring API is working"""
    try:
        sessions = get_collection("sessions")
        events = get_collection("events")
        sessions_count = await sessions.count_documents({})
        events_count = await events.count_documents({})
        
        # Get most recent event
        recent_event = await events.find_one({}, sort=[("server_timestamp", -1)])
        recent_ts = recent_event["server_timestamp"].isoformat() if recent_event else None
        
        return {
            "status": "ok", 
            "sessions_count": sessions_count,
            "events_count": events_count,
            "most_recent_event_at": recent_ts
        }
    except Exception as e:
        logger.error(f"Test endpoint error: {e}", exc_info=True)
        return {"status": "error", "message": str(e)}


@router.get("/sessions", response_model=SessionListResponse)
async def list_sessions(
    experiment_id: Optional[str] = Query(None, description="Filter by experiment"),
    status_filter: Optional[SessionStatus] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    sort_by: str = Query("updated_at", regex="^(created_at|updated_at|completed_at)$"),
    sort_order: str = Query("desc", regex="^(asc|desc)$"),
    current_user: UserInDB = Depends(require_researcher),
):
    """List sessions with filtering and pagination (for monitoring)"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")

    # Build query
    query = {}

    if experiment_id:
        query["experiment_id"] = experiment_id

    if status_filter:
        query["status"] = status_filter.value

    # Non-admins can only see sessions for their own experiments
    if current_user.role != UserRole.ADMIN:
        # Get experiment IDs owned by this user
        owned_experiments = []
        async for exp_doc in experiments.find({"owner_id": current_user.id}):
            owned_experiments.append(exp_doc["experiment_id"])

        if experiment_id:
            if experiment_id not in owned_experiments:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied to this experiment's sessions",
                )
        else:
            query["experiment_id"] = {"$in": owned_experiments}

    # Count total matching documents
    total = await sessions.count_documents(query)

    # Sort direction
    sort_dir = -1 if sort_order == "desc" else 1

    # Paginate
    skip = (page - 1) * page_size
    cursor = sessions.find(query).sort(sort_by, sort_dir).skip(skip).limit(page_size)

    # Build experiment name lookup
    experiment_names = {}
    experiment_configs = {}

    result = []
    async for session_doc in cursor:
        exp_id = session_doc["experiment_id"]

        # Fetch experiment name if not cached
        if exp_id not in experiment_names:
            exp_doc = await experiments.find_one({"experiment_id": exp_id})
            if exp_doc:
                experiment_names[exp_id] = exp_doc.get("name", exp_id)
                experiment_configs[exp_id] = exp_doc.get("config", {})
            else:
                experiment_names[exp_id] = exp_id
                experiment_configs[exp_id] = {}

        # Get stage label from config
        current_stage_label = None
        stages = experiment_configs.get(exp_id, {}).get("stages", [])
        total_stages = len(stages)
        for stage in stages:
            if stage.get("id") == session_doc.get("current_stage_id"):
                current_stage_label = stage.get("label", stage.get("id"))
                break

        completed_count = len(session_doc.get("completed_stages", []))
        progress_pct = (completed_count / total_stages * 100) if total_stages > 0 else 0

        result.append(
            SessionListItem(
                session_id=session_doc["session_id"],
                experiment_id=exp_id,
                experiment_name=experiment_names.get(exp_id),
                user_id=session_doc["user_id"],
                participant_number=session_doc.get("participant_number", 0),
                participant_label=session_doc.get("participant_label"),
                status=SessionStatus(session_doc["status"]),
                current_stage_id=session_doc.get("current_stage_id") or "",
                current_stage_label=current_stage_label,
                completed_stages_count=completed_count,
                total_stages_count=total_stages,
                progress_percentage=progress_pct,
                created_at=session_doc["created_at"],
                updated_at=session_doc["updated_at"],
                completed_at=session_doc.get("completed_at"),
                metadata=session_doc.get("metadata"),
            )
        )

    return SessionListResponse(
        sessions=result,
        total=total,
        page=page,
        page_size=page_size,
        has_more=(skip + len(result)) < total,
    )


@router.get("/sessions/active", response_model=List[SessionListItem])
async def list_active_sessions(
    experiment_id: Optional[str] = Query(None, description="Filter by experiment"),
    limit: int = Query(50, ge=1, le=200),
    current_user: UserInDB = Depends(require_researcher),
):
    """List currently active sessions (for live monitoring)"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")

    # Query for active sessions updated recently (within last 30 minutes)
    recent_cutoff = datetime.utcnow() - timedelta(minutes=30)

    query = {
        "status": SessionStatus.ACTIVE.value,
        "updated_at": {"$gte": recent_cutoff},
    }

    if experiment_id:
        query["experiment_id"] = experiment_id

    # Access control for non-admins
    if current_user.role != UserRole.ADMIN:
        owned_experiments = []
        async for exp_doc in experiments.find({"owner_id": current_user.id}):
            owned_experiments.append(exp_doc["experiment_id"])

        if experiment_id and experiment_id not in owned_experiments:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied",
            )

        if not experiment_id:
            query["experiment_id"] = {"$in": owned_experiments}

    cursor = sessions.find(query).sort("updated_at", -1).limit(limit)

    # Build lookups
    experiment_names = {}
    experiment_configs = {}

    result = []
    async for session_doc in cursor:
        exp_id = session_doc["experiment_id"]

        if exp_id not in experiment_names:
            exp_doc = await experiments.find_one({"experiment_id": exp_id})
            if exp_doc:
                experiment_names[exp_id] = exp_doc.get("name", exp_id)
                experiment_configs[exp_id] = exp_doc.get("config", {})
            else:
                experiment_names[exp_id] = exp_id
                experiment_configs[exp_id] = {}

        current_stage_label = None
        stages = experiment_configs.get(exp_id, {}).get("stages", [])
        total_stages = len(stages)
        for stage in stages:
            if stage.get("id") == session_doc.get("current_stage_id"):
                current_stage_label = stage.get("label", stage.get("id"))
                break

        completed_count = len(session_doc.get("completed_stages", []))
        progress_pct = (completed_count / total_stages * 100) if total_stages > 0 else 0

        result.append(
            SessionListItem(
                session_id=session_doc["session_id"],
                experiment_id=exp_id,
                experiment_name=experiment_names.get(exp_id),
                user_id=session_doc["user_id"],
                participant_number=session_doc.get("participant_number", 0),
                participant_label=session_doc.get("participant_label"),
                status=SessionStatus(session_doc["status"]),
                current_stage_id=session_doc.get("current_stage_id") or "",
                current_stage_label=current_stage_label,
                completed_stages_count=completed_count,
                total_stages_count=total_stages,
                progress_percentage=progress_pct,
                created_at=session_doc["created_at"],
                updated_at=session_doc["updated_at"],
                completed_at=session_doc.get("completed_at"),
                metadata=session_doc.get("metadata"),
            )
        )

    return result


@router.get("/sessions/stats", response_model=SessionStats)
async def get_session_stats(
    experiment_id: Optional[str] = Query(None, description="Filter by experiment"),
    start_date: Optional[datetime] = None,
    end_date: Optional[datetime] = None,
    current_user: UserInDB = Depends(require_researcher),
):
    """Get aggregated session statistics"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")

    # Build base query
    query = {}

    if experiment_id:
        query["experiment_id"] = experiment_id

    if start_date:
        query["created_at"] = {"$gte": start_date}

    if end_date:
        if "created_at" in query:
            query["created_at"]["$lte"] = end_date
        else:
            query["created_at"] = {"$lte": end_date}

    # Access control
    if current_user.role != UserRole.ADMIN:
        owned_experiments = []
        async for exp_doc in experiments.find({"owner_id": current_user.id}):
            owned_experiments.append(exp_doc["experiment_id"])

        if experiment_id and experiment_id not in owned_experiments:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail="Access denied"
            )

        if not experiment_id:
            query["experiment_id"] = {"$in": owned_experiments}

    # Aggregate stats
    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "active": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "active"]}, 1, 0]
                    }
                },
                "completed": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "completed"]}, 1, 0]
                    }
                },
                "abandoned": {
                    "$sum": {
                        "$cond": [{"$eq": ["$status", "abandoned"]}, 1, 0]
                    }
                },
            }
        },
    ]

    stats_result = await sessions.aggregate(pipeline).to_list(1)

    if not stats_result:
        return SessionStats(
            total_sessions=0,
            active_sessions=0,
            completed_sessions=0,
            abandoned_sessions=0,
            completion_rate=0.0,
        )

    stats = stats_result[0]
    total = stats["total"]
    completed = stats["completed"]

    # Calculate average completion time for completed sessions
    avg_time = None
    if completed > 0:
        avg_pipeline = [
            {
                "$match": {
                    **query,
                    "status": "completed",
                    "completed_at": {"$exists": True},
                }
            },
            {
                "$project": {
                    "duration": {
                        "$subtract": ["$completed_at", "$created_at"]
                    }
                }
            },
            {"$group": {"_id": None, "avg_duration": {"$avg": "$duration"}}},
        ]
        avg_result = await sessions.aggregate(avg_pipeline).to_list(1)
        if avg_result and avg_result[0].get("avg_duration"):
            avg_time = avg_result[0]["avg_duration"] / 1000  # Convert ms to seconds

    completion_rate = (completed / total * 100) if total > 0 else 0

    return SessionStats(
        total_sessions=total,
        active_sessions=stats["active"],
        completed_sessions=completed,
        abandoned_sessions=stats["abandoned"],
        completion_rate=completion_rate,
        avg_completion_time_seconds=avg_time,
    )


@router.get("/sessions/over-time", response_model=SessionsOverTimeResponse)
async def get_sessions_over_time(
    experiment_id: Optional[str] = Query(None, description="Filter by experiment"),
    days: int = Query(14, ge=1, le=90, description="Number of days to include"),
    current_user: UserInDB = Depends(require_researcher),
):
    """Get daily session counts over a time period for the Sessions Over Time chart"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")

    # Calculate date range
    end_date = datetime.utcnow().replace(hour=23, minute=59, second=59, microsecond=999999)
    start_date = (end_date - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)

    # Build base query
    query: Dict[str, Any] = {
        "created_at": {"$gte": start_date, "$lte": end_date}
    }

    if experiment_id:
        query["experiment_id"] = experiment_id

    # Access control for non-admins
    if current_user.role != UserRole.ADMIN:
        owned_experiments = []
        async for exp_doc in experiments.find({"owner_id": current_user.id}):
            owned_experiments.append(exp_doc["experiment_id"])

        if experiment_id:
            if experiment_id not in owned_experiments:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Access denied to this experiment's sessions",
                )
        else:
            query["experiment_id"] = {"$in": owned_experiments}

    # Aggregate sessions by day
    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": {
                    "year": {"$year": "$created_at"},
                    "month": {"$month": "$created_at"},
                    "day": {"$dayOfMonth": "$created_at"}
                },
                "sessions": {"$sum": 1},
                "completed": {
                    "$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}
                },
                "abandoned": {
                    "$sum": {"$cond": [{"$eq": ["$status", "abandoned"]}, 1, 0]}
                }
            }
        },
        {"$sort": {"_id.year": 1, "_id.month": 1, "_id.day": 1}}
    ]

    # Fetch aggregated data
    daily_counts: Dict[str, Dict[str, int]] = {}
    async for doc in sessions.aggregate(pipeline):
        date_key = f"{doc['_id']['year']}-{doc['_id']['month']:02d}-{doc['_id']['day']:02d}"
        daily_counts[date_key] = {
            "sessions": doc["sessions"],
            "completed": doc["completed"],
            "abandoned": doc["abandoned"]
        }

    # Build result with all days (including zeros)
    result: List[DailySessionData] = []
    for i in range(days):
        current_date = start_date + timedelta(days=i)
        date_key = current_date.strftime("%Y-%m-%d")
        date_short = current_date.strftime("%b %d")  # e.g., "Jan 15"

        counts = daily_counts.get(date_key, {"sessions": 0, "completed": 0, "abandoned": 0})
        result.append(DailySessionData(
            date=date_short,
            date_full=date_key,
            sessions=counts["sessions"],
            completed=counts["completed"],
            abandoned=counts["abandoned"]
        ))

    return SessionsOverTimeResponse(data=result, period_days=days)


@router.get("/experiments/{experiment_id}/sessions/stats", response_model=ExperimentSessionStats)
async def get_experiment_session_stats(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Get detailed session statistics for a specific experiment"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")

    # Get experiment
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )

    # Access control
    if current_user.role != UserRole.ADMIN and exp_doc["owner_id"] != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    query = {"experiment_id": experiment_id}

    # Get basic stats
    pipeline = [
        {"$match": query},
        {
            "$group": {
                "_id": None,
                "total": {"$sum": 1},
                "active": {"$sum": {"$cond": [{"$eq": ["$status", "active"]}, 1, 0]}},
                "completed": {"$sum": {"$cond": [{"$eq": ["$status", "completed"]}, 1, 0]}},
                "abandoned": {"$sum": {"$cond": [{"$eq": ["$status", "abandoned"]}, 1, 0]}},
            }
        },
    ]

    stats_result = await sessions.aggregate(pipeline).to_list(1)

    if not stats_result:
        stats = SessionStats(
            total_sessions=0,
            active_sessions=0,
            completed_sessions=0,
            abandoned_sessions=0,
            completion_rate=0.0,
        )
    else:
        s = stats_result[0]
        total = s["total"]
        completed = s["completed"]
        completion_rate = (completed / total * 100) if total > 0 else 0

        stats = SessionStats(
            total_sessions=total,
            active_sessions=s["active"],
            completed_sessions=completed,
            abandoned_sessions=s["abandoned"],
            completion_rate=completion_rate,
        )

    # Calculate stage completion rates
    stages = exp_doc.get("config", {}).get("stages", [])
    stage_completion_rates = {}

    if stats.total_sessions > 0:
        for stage in stages:
            stage_id = stage.get("id")
            if not stage_id:
                continue

            completed_count = await sessions.count_documents(
                {"experiment_id": experiment_id, "completed_stages": stage_id}
            )
            stage_completion_rates[stage_id] = (
                completed_count / stats.total_sessions * 100
            )

    # Get recent sessions
    recent_cursor = (
        sessions.find(query).sort("updated_at", -1).limit(10)
    )

    recent_sessions = []
    async for session_doc in recent_cursor:
        current_stage_label = None
        total_stages = len(stages)
        for stage in stages:
            if stage.get("id") == session_doc.get("current_stage_id"):
                current_stage_label = stage.get("label", stage.get("id"))
                break

        completed_count = len(session_doc.get("completed_stages", []))
        progress_pct = (completed_count / total_stages * 100) if total_stages > 0 else 0

        recent_sessions.append(
            SessionListItem(
                session_id=session_doc["session_id"],
                experiment_id=experiment_id,
                experiment_name=exp_doc.get("name"),
                user_id=session_doc["user_id"],
                participant_number=session_doc.get("participant_number", 0),
                participant_label=session_doc.get("participant_label"),
                status=SessionStatus(session_doc["status"]),
                current_stage_id=session_doc.get("current_stage_id") or "",
                current_stage_label=current_stage_label,
                completed_stages_count=completed_count,
                total_stages_count=total_stages,
                progress_percentage=progress_pct,
                created_at=session_doc["created_at"],
                updated_at=session_doc["updated_at"],
                completed_at=session_doc.get("completed_at"),
                metadata=session_doc.get("metadata"),
            )
        )

    return ExperimentSessionStats(
        experiment_id=experiment_id,
        experiment_name=exp_doc.get("name", experiment_id),
        stats=stats,
        stage_completion_rates=stage_completion_rates,
        recent_sessions=recent_sessions,
    )


@router.get("/live/events", response_model=LiveEventsResponse)
async def get_live_events(
    experiment_id: Optional[str] = Query(None, description="Filter by experiment"),
    session_id: Optional[str] = Query(None, description="Filter by specific session"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter by session status: active, completed, all"),
    since: Optional[datetime] = Query(None, description="Get events after this timestamp"),
    limit: int = Query(100, ge=1, le=500),
    current_user: UserInDB = Depends(require_researcher),
):
    """Get live events stream for real-time monitoring"""
    try:
        events = get_collection("events")
        sessions = get_collection("sessions")
        experiments = get_collection("experiments")

        # Build events query
        query: Dict[str, Any] = {}

        if experiment_id:
            query["experiment_id"] = experiment_id

        if session_id:
            query["session_id"] = session_id

        if since:
            query["server_timestamp"] = {"$gt": since}

        # Filter by session status if specified
        if status_filter and status_filter != "all":
            # Get session IDs matching the status
            session_query: Dict[str, Any] = {}
            if experiment_id:
                session_query["experiment_id"] = experiment_id
            if status_filter == "active":
                session_query["status"] = SessionStatus.ACTIVE.value
            elif status_filter == "completed":
                session_query["status"] = SessionStatus.COMPLETED.value

            matching_sessions = await sessions.distinct("session_id", session_query)
            if matching_sessions:
                query["session_id"] = {"$in": matching_sessions}
            else:
                return LiveEventsResponse(events=[], total=0, last_timestamp=None)

        # Access control for non-admins
        user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
        is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
        
        if not is_admin:
            owned_experiments = []
            async for exp_doc in experiments.find({"owner_id": user_id}):
                owned_experiments.append(exp_doc["experiment_id"])

            if experiment_id:
                if experiment_id not in owned_experiments:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied to this experiment's events",
                    )
            else:
                if owned_experiments:
                    query["experiment_id"] = {"$in": owned_experiments}
                else:
                    return LiveEventsResponse(events=[], total=0, last_timestamp=None)

        # Fetch events
        cursor = events.find(query).sort("server_timestamp", -1).limit(limit)
        
        result = []
        last_ts = None
        async for event_doc in cursor:
            result.append(LiveEvent(
                event_id=event_doc["event_id"],
                session_id=event_doc["session_id"],
                user_id=event_doc["user_id"],
                participant_number=event_doc.get("participant_number", 0),
                participant_label=event_doc.get("participant_label"),
                event_type=event_doc["event_type"],
                stage_id=event_doc["stage_id"],
                block_id=event_doc.get("block_id"),
                payload=event_doc.get("payload", {}),
                client_timestamp=event_doc["client_timestamp"],
                server_timestamp=event_doc["server_timestamp"],
            ))
            if last_ts is None:
                last_ts = event_doc["server_timestamp"]

        # Reverse to get chronological order
        result.reverse()

        return LiveEventsResponse(
            events=result,
            total=len(result),
            last_timestamp=last_ts,
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_live_events: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching live events: {str(e)}"
        )


@router.get("/live/sessions", response_model=List[SessionListItem])
async def get_live_sessions(
    experiment_id: Optional[str] = Query(None, description="Filter by experiment"),
    status_filter: Optional[str] = Query(None, alias="status", description="Filter: active, completed, abandoned, all"),
    limit: int = Query(100, ge=1, le=500),
    current_user: UserInDB = Depends(require_researcher),
):
    """Get sessions for live monitoring with progress info"""
    try:
        logger.info(f"get_live_sessions called by user: {current_user.username}, role: {current_user.role}")
        
        sessions = get_collection("sessions")
        experiments = get_collection("experiments")

        # Build query
        query: Dict[str, Any] = {}

        if experiment_id:
            query["experiment_id"] = experiment_id

        if status_filter and status_filter != "all":
            if status_filter == "active":
                query["status"] = SessionStatus.ACTIVE.value
            elif status_filter == "completed":
                query["status"] = SessionStatus.COMPLETED.value
            elif status_filter == "abandoned":
                query["status"] = SessionStatus.ABANDONED.value

        # Access control for non-admins
        # Get user ID - try different attribute names for compatibility
        user_id = None
        for attr in ['id', '_id']:
            try:
                user_id = getattr(current_user, attr, None)
                if user_id:
                    break
            except Exception:
                pass
        
        logger.info(f"User ID: {user_id}, Role: {current_user.role}, Role type: {type(current_user.role)}")
        
        # Check if admin - handle both enum and string comparisons
        is_admin = False
        try:
            is_admin = current_user.role == UserRole.ADMIN
        except Exception:
            pass
        if not is_admin:
            is_admin = str(current_user.role).lower() == "admin"
        
        logger.info(f"Is admin: {is_admin}")
        
        if not is_admin:
            owned_experiments = []
            async for exp_doc in experiments.find({"owner_id": user_id}):
                owned_experiments.append(exp_doc["experiment_id"])

            if experiment_id:
                if experiment_id not in owned_experiments:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Access denied",
                    )
            else:
                if owned_experiments:
                    query["experiment_id"] = {"$in": owned_experiments}
                else:
                    # No owned experiments, return empty list
                    return []

        cursor = sessions.find(query).sort("updated_at", -1).limit(limit)

        # Build experiment lookups
        experiment_names: Dict[str, str] = {}
        experiment_configs: Dict[str, Any] = {}

        result = []
        async for session_doc in cursor:
            exp_id = session_doc["experiment_id"]

            if exp_id not in experiment_names:
                exp_doc = await experiments.find_one({"experiment_id": exp_id})
                if exp_doc:
                    experiment_names[exp_id] = exp_doc.get("name", exp_id)
                    experiment_configs[exp_id] = exp_doc.get("config", {})
                else:
                    experiment_names[exp_id] = exp_id
                    experiment_configs[exp_id] = {}

            current_stage_label = None
            stages = experiment_configs.get(exp_id, {}).get("stages", [])
            total_stages = len(stages)
            for stage in stages:
                if stage.get("id") == session_doc.get("current_stage_id"):
                    current_stage_label = stage.get("label", stage.get("id"))
                    break

            completed_count = len(session_doc.get("completed_stages", []))
            progress_pct = (completed_count / total_stages * 100) if total_stages > 0 else 0

            result.append(
                SessionListItem(
                    session_id=session_doc["session_id"],
                    experiment_id=exp_id,
                    experiment_name=experiment_names.get(exp_id),
                    user_id=session_doc["user_id"],
                    participant_number=session_doc.get("participant_number", 0),
                    participant_label=session_doc.get("participant_label"),
                    status=SessionStatus(session_doc["status"]),
                    current_stage_id=session_doc.get("current_stage_id") or "",
                    current_stage_label=current_stage_label,
                    completed_stages_count=completed_count,
                    total_stages_count=total_stages,
                    progress_percentage=progress_pct,
                    created_at=session_doc["created_at"],
                    updated_at=session_doc["updated_at"],
                    completed_at=session_doc.get("completed_at"),
                    metadata=session_doc.get("metadata"),
                )
            )

        return result
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_live_sessions: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching live sessions: {str(e)}"
        )


@router.get("/live/stats/{experiment_id}", response_model=ExperimentLiveStats)
async def get_live_statistics(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Get live statistics for an experiment including per-block/question stats"""
    logger.info(f"get_live_statistics called for experiment: {experiment_id}")
    try:
        sessions = get_collection("sessions")
        experiments = get_collection("experiments")
        events = get_collection("events")

        # Get experiment
        exp_doc = await experiments.find_one({"experiment_id": experiment_id})
        if not exp_doc:
            logger.warning(f"Experiment not found: {experiment_id}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Experiment not found"
            )

        # Access control
        user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
        is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
        
        if not is_admin and exp_doc["owner_id"] != user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

        # Get basic session counts
        session_pipeline = [
            {"$match": {"experiment_id": experiment_id}},
            {
                "$group": {
                    "_id": "$status",
                    "count": {"$sum": 1}
                }
            }
        ]

        status_counts: Dict[str, int] = {}
        async for doc in sessions.aggregate(session_pipeline):
            status_counts[doc["_id"]] = doc["count"]

        total = sum(status_counts.values())
        completed = status_counts.get("completed", 0)
        active = status_counts.get("active", 0)
        abandoned = status_counts.get("abandoned", 0)
        completion_rate = (completed / total * 100) if total > 0 else 0

        # Build stage statistics
        stages_config = exp_doc.get("config", {}).get("stages", [])
        stage_stats: List[StageStatistics] = []

        for stage_config in stages_config:
            stage_id = stage_config.get("id")
            if not stage_id:
                continue

            # Count stage views and completions from events
            view_count = await events.count_documents({
                "experiment_id": experiment_id,
                "stage_id": stage_id,
                "event_type": "stage_view"
            })

            completion_count = await events.count_documents({
                "experiment_id": experiment_id,
                "stage_id": stage_id,
                "event_type": "stage_submit"
            })

            # Calculate average time on stage
            avg_time = None
            time_pipeline = [
                {"$match": {
                    "experiment_id": experiment_id,
                    "stage_id": stage_id,
                    "event_type": {"$in": ["stage_view", "stage_submit"]}
                }},
                {"$sort": {"session_id": 1, "server_timestamp": 1}},
                {"$group": {
                    "_id": "$session_id",
                    "events": {"$push": {
                        "event_type": "$event_type",
                        "timestamp": "$server_timestamp"
                    }}
                }}
            ]

            durations = []
            async for session_events in events.aggregate(time_pipeline):
                evts = session_events["events"]
                view_time = None
                for evt in evts:
                    if evt["event_type"] == "stage_view":
                        view_time = evt["timestamp"]
                    elif evt["event_type"] == "stage_submit" and view_time:
                        duration = (evt["timestamp"] - view_time).total_seconds()
                        if 0 < duration < 3600:  # Reasonable bounds
                            durations.append(duration)
                        view_time = None

            if durations:
                avg_time = sum(durations) / len(durations)

            # Build block statistics
            blocks_config = stage_config.get("blocks", [])
            block_stats: List[BlockStatistics] = []

            for block_config in blocks_config:
                block_id = block_config.get("id")
                block_type = block_config.get("type", "unknown")
                if not block_id:
                    continue

                # Get all responses for this block from session data
                response_pipeline = [
                    {"$match": {"experiment_id": experiment_id}},
                    {"$project": {
                        "response": f"$data.{stage_id}.{block_id}",
                        "has_response": {"$cond": [{"$ifNull": [f"$data.{stage_id}.{block_id}", False]}, 1, 0]}
                    }},
                    {"$match": {"has_response": 1}}
                ]

                responses = []
                async for doc in sessions.aggregate(response_pipeline):
                    if doc.get("response") is not None:
                        responses.append(doc["response"])

                response_count = len(responses)

                # Calculate statistics based on block type
                min_val = max_val = avg_val = median_val = None
                value_dist = None

                if responses:
                    # Try to extract numeric values
                    numeric_responses = []
                    categorical_responses = []

                    for resp in responses:
                        if isinstance(resp, dict):
                            # Handle likert scale, questionnaire responses
                            for key, val in resp.items():
                                if isinstance(val, (int, float)):
                                    numeric_responses.append(val)
                                elif isinstance(val, str):
                                    categorical_responses.append(val)
                        elif isinstance(resp, (int, float)):
                            numeric_responses.append(resp)
                        elif isinstance(resp, str):
                            categorical_responses.append(resp)
                        elif isinstance(resp, list):
                            # Multiple choice answers
                            for item in resp:
                                if isinstance(item, str):
                                    categorical_responses.append(item)

                    if numeric_responses:
                        min_val = min(numeric_responses)
                        max_val = max(numeric_responses)
                        avg_val = sum(numeric_responses) / len(numeric_responses)
                        sorted_nums = sorted(numeric_responses)
                        mid = len(sorted_nums) // 2
                        if len(sorted_nums) % 2 == 0:
                            median_val = (sorted_nums[mid - 1] + sorted_nums[mid]) / 2
                        else:
                            median_val = sorted_nums[mid]

                    if categorical_responses:
                        value_dist = {}
                        for val in categorical_responses:
                            value_dist[str(val)] = value_dist.get(str(val), 0) + 1

                block_stats.append(BlockStatistics(
                    block_id=block_id,
                    block_type=block_type,
                    response_count=response_count,
                    min_value=min_val,
                    max_value=max_val,
                    avg_value=avg_val,
                    median_value=median_val,
                    value_distribution=value_dist,
                ))

            stage_stats.append(StageStatistics(
                stage_id=stage_id,
                stage_label=stage_config.get("label"),
                view_count=view_count,
                completion_count=completion_count,
                avg_time_seconds=avg_time,
                blocks=block_stats,
            ))

        logger.info(f"Stats for {experiment_id}: total={total}, active={active}, completed={completed}, stages={len(stage_stats)}")
        
        return ExperimentLiveStats(
            experiment_id=experiment_id,
            experiment_name=exp_doc.get("name", experiment_id),
            total_sessions=total,
            active_sessions=active,
            completed_sessions=completed,
            abandoned_sessions=abandoned,
            completion_rate=completion_rate,
            stages=stage_stats,
            updated_at=datetime.utcnow(),
        )
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error in get_live_statistics: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error fetching live statistics: {str(e)}"
        )


async def update_events_participant_label(session_id: str, participant_label: Optional[str]):
    """Background task to retroactively update participant_label in all events for a session"""
    try:
        events = get_collection("events")
        result = await events.update_many(
            {"session_id": session_id},
            {"$set": {"participant_label": participant_label}}
        )
        logger.info(f"Updated {result.modified_count} events for session {session_id} with label '{participant_label}'")
        return result.modified_count
    except Exception as e:
        logger.error(f"Error updating events for session {session_id}: {e}", exc_info=True)
        return 0


@router.patch("/sessions/{session_id}/participant-label", response_model=UpdateParticipantLabelResponse)
async def update_participant_label(
    session_id: str,
    request: UpdateParticipantLabelRequest,
    background_tasks: BackgroundTasks,
    current_user: UserInDB = Depends(require_researcher),
):
    """Update the participant label for a session (admin action)"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    
    # Get session
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Access control
    user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
    
    if not is_admin:
        # Check if user owns the experiment
        exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
        if not exp_doc or exp_doc.get("owner_id") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Update session
    new_label = request.participant_label.strip() if request.participant_label else None
    await sessions.update_one(
        {"session_id": session_id},
        {"$set": {
            "participant_label": new_label,
            "updated_at": datetime.utcnow()
        }}
    )
    
    # Queue background task to update events retroactively
    background_tasks.add_task(update_events_participant_label, session_id, new_label)
    
    # Get event count for immediate response (approximate)
    events = get_collection("events")
    events_count = await events.count_documents({"session_id": session_id})
    
    return UpdateParticipantLabelResponse(
        session_id=session_id,
        participant_number=session_doc.get("participant_number", 0),
        participant_label=new_label,
        events_updated=events_count,
    )


class ClearAllDataRequest(BaseModel):
    """Request to clear all monitoring data"""
    confirmation: str  # Must be "yes" to proceed


class ClearAllDataResponse(BaseModel):
    """Response after clearing all monitoring data"""
    sessions_deleted: int
    events_deleted: int
    message: str


@router.delete("/data/all", response_model=ClearAllDataResponse)
async def clear_all_monitoring_data(
    request: ClearAllDataRequest,
    current_user: UserInDB = Depends(require_researcher),
):
    """
    Clear ALL sessions and events from the database.
    This is a destructive operation and requires confirmation.
    Only admins can perform this action.
    """
    # Check if user is admin
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role).lower() == "admin"
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can clear all data"
        )
    
    # Require explicit confirmation
    if request.confirmation.lower().strip() != "yes":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation must be 'yes' to proceed with data deletion"
        )
    
    sessions = get_collection("sessions")
    events = get_collection("events")
    
    try:
        # Delete all events
        events_result = await events.delete_many({})
        events_deleted = events_result.deleted_count
        
        # Delete all sessions
        sessions_result = await sessions.delete_many({})
        sessions_deleted = sessions_result.deleted_count
        
        logger.info(
            f"Admin {current_user.username} cleared all monitoring data: "
            f"{sessions_deleted} sessions, {events_deleted} events"
        )
        
        return ClearAllDataResponse(
            sessions_deleted=sessions_deleted,
            events_deleted=events_deleted,
            message=f"Successfully deleted {sessions_deleted} sessions and {events_deleted} events"
        )
    except Exception as e:
        logger.error(f"Error clearing monitoring data: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error clearing data: {str(e)}"
        )


@router.get("/sessions/{session_id}/details")
async def get_session_details(
    session_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Get detailed session information including participant info"""
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Access control
    user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
    
    if not is_admin:
        exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
        if not exp_doc or exp_doc.get("owner_id") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Get experiment name
    exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
    experiment_name = exp_doc.get("name", session_doc["experiment_id"]) if exp_doc else session_doc["experiment_id"]
    
    return {
        "session_id": session_doc["session_id"],
        "experiment_id": session_doc["experiment_id"],
        "experiment_name": experiment_name,
        "user_id": session_doc["user_id"],
        "participant_number": session_doc.get("participant_number", 0),
        "participant_label": session_doc.get("participant_label"),
        "participant_display": session_doc.get("participant_label") or f"P{session_doc.get('participant_number', 0)}",
        "status": session_doc["status"],
        "current_stage_id": session_doc.get("current_stage_id"),
        "completed_stages": session_doc.get("completed_stages", []),
        "created_at": session_doc["created_at"],
        "updated_at": session_doc["updated_at"],
        "completed_at": session_doc.get("completed_at"),
        "metadata": session_doc.get("metadata", {}),
    }


# ============================================================================
# 4-Level Hierarchy Debug Endpoints
# ============================================================================

class StateRegistryResponse(BaseModel):
    """Full participant state registry for debugging"""
    session_id: str
    experiment_id: str
    participant: Dict[str, Any]
    environment: Dict[str, Any]
    responses: Dict[str, Any]
    scores: Dict[str, Any]
    assignments: Dict[str, Any]
    metadata: Dict[str, Any]


class DistributionStats(BaseModel):
    """Distribution statistics for an experiment level"""
    level_id: str
    children: Dict[str, Dict[str, int]]  # child_id -> {started, completed, active}
    totals: Dict[str, int]


class ExperimentDistributionResponse(BaseModel):
    """Full distribution statistics for an experiment"""
    experiment_id: str
    levels: Dict[str, DistributionStats]
    generated_at: datetime


class AssignmentReason(BaseModel):
    """Detailed assignment reasoning"""
    level_id: str
    assigned_child_id: str
    ordering_mode: str
    reason: str
    timestamp: datetime
    counts_at_time: Optional[Dict[str, int]] = None


@router.get("/sessions/{session_id}/state-registry", response_model=StateRegistryResponse)
async def get_session_state_registry(
    session_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """
    Get the full participant state registry for debugging.
    Shows all collected data, assignments, and computed scores.
    """
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    participant_registry = get_collection("participant_registry")
    
    # Get session
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Access control
    user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
    
    if not is_admin:
        exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
        if not exp_doc or exp_doc.get("owner_id") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Get participant registry data
    registry_doc = await participant_registry.find_one({"session_id": session_id})
    
    if registry_doc:
        return StateRegistryResponse(
            session_id=session_id,
            experiment_id=session_doc["experiment_id"],
            participant=registry_doc.get("participant", {}),
            environment=registry_doc.get("environment", {}),
            responses=registry_doc.get("responses", {}),
            scores=registry_doc.get("scores", {}),
            assignments=registry_doc.get("assignments", {}),
            metadata=registry_doc.get("metadata", {}),
        )
    
    # Fallback to session data if no registry exists
    return StateRegistryResponse(
        session_id=session_id,
        experiment_id=session_doc["experiment_id"],
        participant={},
        environment=session_doc.get("metadata", {}),
        responses=session_doc.get("data", {}),
        scores={},
        assignments=session_doc.get("assignments", {}),
        metadata=session_doc.get("metadata", {}),
    )


@router.get("/experiments/{experiment_id}/distribution")
async def get_experiment_distribution(
    experiment_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """
    Get distribution statistics for all balanced/weighted levels in an experiment.
    Shows current counts and allocation status.
    """
    experiments = get_collection("experiments")
    distribution_counters = get_collection("distribution_counters")
    
    # Get experiment
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Access control
    user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
    
    if not is_admin and exp_doc.get("owner_id") != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Get all distribution counters for this experiment
    cursor = distribution_counters.find({"experiment_id": experiment_id})
    
    levels: Dict[str, Dict[str, Any]] = {}
    
    async for doc in cursor:
        level_id = doc.get("level_id")
        child_id = doc.get("child_id")
        
        if level_id not in levels:
            levels[level_id] = {
                "children": {},
                "totals": {"started": 0, "completed": 0, "active": 0}
            }
        
        stats = {
            "started": doc.get("started_count", 0),
            "completed": doc.get("completed_count", 0),
            "active": doc.get("active_count", 0),
        }
        
        levels[level_id]["children"][child_id] = stats
        levels[level_id]["totals"]["started"] += stats["started"]
        levels[level_id]["totals"]["completed"] += stats["completed"]
        levels[level_id]["totals"]["active"] += stats["active"]
    
    return {
        "experiment_id": experiment_id,
        "levels": levels,
        "generated_at": datetime.utcnow().isoformat(),
    }


@router.get("/sessions/{session_id}/assignment-history")
async def get_session_assignment_history(
    session_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """
    Get the assignment history for a session.
    Shows detailed reasoning for each balanced/weighted assignment.
    """
    sessions = get_collection("sessions")
    experiments = get_collection("experiments")
    participant_registry = get_collection("participant_registry")
    
    # Get session
    session_doc = await sessions.find_one({"session_id": session_id})
    if not session_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )
    
    # Access control
    user_id = getattr(current_user, 'id', None) or getattr(current_user, '_id', None)
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
    
    if not is_admin:
        exp_doc = await experiments.find_one({"experiment_id": session_doc["experiment_id"]})
        if not exp_doc or exp_doc.get("owner_id") != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    # Get assignment history from session or registry
    assignment_history = session_doc.get("assignment_history", [])
    
    # Also check participant registry
    registry_doc = await participant_registry.find_one({"session_id": session_id})
    if registry_doc:
        assignments = registry_doc.get("assignments", {})
        for level_id, assignment in assignments.items():
            if isinstance(assignment, dict):
                assignment_history.append({
                    "level_id": level_id,
                    "assigned_child_id": assignment.get("child_id"),
                    "ordering_mode": "unknown",
                    "reason": assignment.get("reason", "No reason recorded"),
                    "timestamp": assignment.get("timestamp"),
                })
    
    return {
        "session_id": session_id,
        "experiment_id": session_doc["experiment_id"],
        "current_assignments": session_doc.get("assignments", {}),
        "history": assignment_history,
    }


@router.post("/experiments/{experiment_id}/reset-counters")
async def reset_experiment_counters(
    experiment_id: str,
    level_id: Optional[str] = Query(None, description="Reset only this level (optional)"),
    current_user: UserInDB = Depends(require_researcher),
):
    """
    Reset distribution counters for an experiment.
    Use this when restarting data collection.
    """
    experiments = get_collection("experiments")
    distribution_counters = get_collection("distribution_counters")
    
    # Get experiment
    exp_doc = await experiments.find_one({"experiment_id": experiment_id})
    if not exp_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Experiment not found"
        )
    
    # Access control - only admins can reset counters
    is_admin = current_user.role == UserRole.ADMIN or str(current_user.role) == "admin"
    if not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can reset distribution counters"
        )
    
    # Build query
    query = {"experiment_id": experiment_id}
    if level_id:
        query["level_id"] = level_id
    
    # Delete counters
    result = await distribution_counters.delete_many(query)
    
    logger.info(
        f"Admin {current_user.username} reset distribution counters for experiment {experiment_id}: "
        f"{result.deleted_count} counters deleted"
    )
    
    return {
        "experiment_id": experiment_id,
        "level_id": level_id,
        "counters_deleted": result.deleted_count,
        "message": f"Successfully reset {result.deleted_count} distribution counters"
    }

