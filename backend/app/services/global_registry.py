"""
Global Registry service for experiment-wide state management.

Tracks:
- Distribution counters for balanced/weighted assignment
- Quota usage per branch
- Active participant counts
"""
import logging
from datetime import datetime, timedelta
from typing import Dict, Any, Optional, List
from motor.motor_asyncio import AsyncIOMotorDatabase

logger = logging.getLogger(__name__)


class GlobalRegistry:
    """
    Manages experiment-wide state including distribution counters and quotas.
    Uses MongoDB with atomic operations for concurrency safety.
    """
    
    COUNTERS_COLLECTION = "distribution_counters"
    QUOTAS_COLLECTION = "quota_usage"
    
    def __init__(self, db: AsyncIOMotorDatabase):
        self.db = db
        self.counters = db[self.COUNTERS_COLLECTION]
        self.quotas = db[self.QUOTAS_COLLECTION]
    
    # =========================================================================
    # Distribution Counter Operations
    # =========================================================================
    
    async def get_counter(
        self,
        experiment_id: str,
        level_id: str,
        child_id: str,
    ) -> Dict[str, int]:
        """Get counter values for a specific child"""
        doc = await self.counters.find_one({
            "experiment_id": experiment_id,
            "level_id": level_id,
            "child_id": child_id,
        })
        
        if doc:
            return {
                "started": doc.get("started_count", 0),
                "completed": doc.get("completed_count", 0),
                "active": doc.get("active_count", 0),
            }
        
        return {"started": 0, "completed": 0, "active": 0}
    
    async def get_all_counters(
        self,
        experiment_id: str,
        level_id: str,
    ) -> Dict[str, Dict[str, int]]:
        """Get all counters for children of a level"""
        cursor = self.counters.find({
            "experiment_id": experiment_id,
            "level_id": level_id,
        })
        
        result = {}
        async for doc in cursor:
            child_id = doc.get("child_id")
            result[child_id] = {
                "started": doc.get("started_count", 0),
                "completed": doc.get("completed_count", 0),
                "active": doc.get("active_count", 0),
            }
        
        return result
    
    async def increment_started(
        self,
        experiment_id: str,
        level_id: str,
        child_id: str,
        session_id: str,
    ) -> Dict[str, int]:
        """
        Atomically increment started count.
        Also tracks active count for cleanup.
        """
        result = await self.counters.find_one_and_update(
            {
                "experiment_id": experiment_id,
                "level_id": level_id,
                "child_id": child_id,
            },
            {
                "$inc": {"started_count": 1, "active_count": 1},
                "$set": {"last_updated": datetime.utcnow()},
                "$addToSet": {"active_sessions": session_id},
                "$setOnInsert": {
                    "experiment_id": experiment_id,
                    "level_id": level_id,
                    "child_id": child_id,
                    "created_at": datetime.utcnow(),
                    "completed_count": 0,
                }
            },
            upsert=True,
            return_document=True,
        )
        
        return {
            "started": result.get("started_count", 1),
            "completed": result.get("completed_count", 0),
            "active": result.get("active_count", 1),
        }
    
    async def increment_completed(
        self,
        experiment_id: str,
        level_id: str,
        child_id: str,
        session_id: str,
    ) -> None:
        """
        Increment completed count and decrement active.
        Called when participant finishes the assigned branch.
        """
        await self.counters.find_one_and_update(
            {
                "experiment_id": experiment_id,
                "level_id": level_id,
                "child_id": child_id,
            },
            {
                "$inc": {"completed_count": 1, "active_count": -1},
                "$set": {"last_updated": datetime.utcnow()},
                "$pull": {"active_sessions": session_id},
            }
        )
    
    async def decrement_started(
        self,
        experiment_id: str,
        level_id: str,
        child_id: str,
        session_id: str,
    ) -> None:
        """
        Decrement started and active counts (for timeout/abandonment cleanup).
        """
        await self.counters.find_one_and_update(
            {
                "experiment_id": experiment_id,
                "level_id": level_id,
                "child_id": child_id,
            },
            {
                "$inc": {"started_count": -1, "active_count": -1},
                "$set": {"last_updated": datetime.utcnow()},
                "$pull": {"active_sessions": session_id},
            }
        )
    
    async def cleanup_stale_sessions(
        self,
        experiment_id: str,
        timeout_hours: int = 2,
    ) -> int:
        """
        Clean up stale started counts from abandoned sessions.
        Returns number of cleaned up entries.
        """
        threshold = datetime.utcnow() - timedelta(hours=timeout_hours)
        
        # Find all counters with stale active sessions
        cursor = self.counters.find({
            "experiment_id": experiment_id,
            "active_count": {"$gt": 0},
            "last_updated": {"$lt": threshold},
        })
        
        cleanup_count = 0
        async for doc in cursor:
            stale_count = doc.get("active_count", 0)
            if stale_count > 0:
                await self.counters.update_one(
                    {"_id": doc["_id"]},
                    {
                        "$inc": {"started_count": -stale_count, "active_count": -stale_count},
                        "$set": {"active_sessions": [], "last_updated": datetime.utcnow()},
                    }
                )
                cleanup_count += stale_count
        
        return cleanup_count
    
    async def reset_counters(
        self,
        experiment_id: str,
        level_id: Optional[str] = None,
    ) -> int:
        """
        Reset counters for an experiment (for restart).
        If level_id provided, only reset that level.
        """
        query = {"experiment_id": experiment_id}
        if level_id:
            query["level_id"] = level_id
        
        result = await self.counters.delete_many(query)
        return result.deleted_count
    
    # =========================================================================
    # Quota Operations
    # =========================================================================
    
    async def check_quota(
        self,
        experiment_id: str,
        level_id: str,
        child_id: str,
        quota_limit: int,
    ) -> bool:
        """
        Check if quota is available for a branch.
        Returns True if there's room, False if quota is full.
        """
        doc = await self.quotas.find_one({
            "experiment_id": experiment_id,
            "level_id": level_id,
            "child_id": child_id,
        })
        
        current = doc.get("count", 0) if doc else 0
        return current < quota_limit
    
    async def increment_quota(
        self,
        experiment_id: str,
        level_id: str,
        child_id: str,
        session_id: str,
    ) -> int:
        """
        Increment quota usage. Returns new count.
        """
        result = await self.quotas.find_one_and_update(
            {
                "experiment_id": experiment_id,
                "level_id": level_id,
                "child_id": child_id,
            },
            {
                "$inc": {"count": 1},
                "$set": {"last_updated": datetime.utcnow()},
                "$addToSet": {"sessions": session_id},
                "$setOnInsert": {
                    "experiment_id": experiment_id,
                    "level_id": level_id,
                    "child_id": child_id,
                    "created_at": datetime.utcnow(),
                }
            },
            upsert=True,
            return_document=True,
        )
        
        return result.get("count", 1)
    
    async def get_quota_usage(
        self,
        experiment_id: str,
        level_id: str,
    ) -> Dict[str, int]:
        """Get quota usage for all children of a level"""
        cursor = self.quotas.find({
            "experiment_id": experiment_id,
            "level_id": level_id,
        })
        
        result = {}
        async for doc in cursor:
            child_id = doc.get("child_id")
            result[child_id] = doc.get("count", 0)
        
        return result
    
    # =========================================================================
    # Combined Stats for Dashboard
    # =========================================================================
    
    async def get_distribution_dashboard(
        self,
        experiment_id: str,
    ) -> Dict[str, Any]:
        """
        Get comprehensive distribution stats for admin dashboard.
        """
        # Get all counters for this experiment
        cursor = self.counters.find({"experiment_id": experiment_id})
        
        by_level: Dict[str, Dict[str, Any]] = {}
        
        async for doc in cursor:
            level_id = doc.get("level_id")
            child_id = doc.get("child_id")
            
            if level_id not in by_level:
                by_level[level_id] = {"children": {}, "totals": {"started": 0, "completed": 0, "active": 0}}
            
            stats = {
                "started": doc.get("started_count", 0),
                "completed": doc.get("completed_count", 0),
                "active": doc.get("active_count", 0),
            }
            
            by_level[level_id]["children"][child_id] = stats
            by_level[level_id]["totals"]["started"] += stats["started"]
            by_level[level_id]["totals"]["completed"] += stats["completed"]
            by_level[level_id]["totals"]["active"] += stats["active"]
        
        return {
            "experiment_id": experiment_id,
            "levels": by_level,
            "generated_at": datetime.utcnow().isoformat(),
        }


# Index creation for performance
async def create_global_registry_indexes(db: AsyncIOMotorDatabase):
    """Create indexes for optimal query performance"""
    counters = db[GlobalRegistry.COUNTERS_COLLECTION]
    quotas = db[GlobalRegistry.QUOTAS_COLLECTION]
    
    await counters.create_index([
        ("experiment_id", 1),
        ("level_id", 1),
        ("child_id", 1),
    ], unique=True)
    
    await counters.create_index([
        ("experiment_id", 1),
        ("level_id", 1),
    ])
    
    await quotas.create_index([
        ("experiment_id", 1),
        ("level_id", 1),
        ("child_id", 1),
    ], unique=True)


