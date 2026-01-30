"""
Participant Registry service for centralized session variables.

Provides a single source of truth for all participant state that can be:
- Used in visibility rules
- Used for scoring/calculations
- Persisted for session recovery
"""
import logging
import json
from datetime import datetime
from typing import Dict, Any, Optional, List
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.redis_client import get_redis

logger = logging.getLogger(__name__)


class ParticipantRegistry:
    """
    Centralized registry for participant session variables.
    
    Structure:
    {
        "participant": { ... demographic data ... },
        "environment": { ... device/browser info ... },
        "responses": { ... stage responses ... },
        "scores": { ... computed scores ... },
        "assignments": { ... balanced/weighted assignments ... },
        "metadata": { ... URL params, timestamps, etc. ... }
    }
    """
    
    REDIS_KEY_PREFIX = "participant_state"
    REDIS_TTL = 86400  # 24 hours
    
    def __init__(self, db: Optional[AsyncIOMotorDatabase] = None):
        self.db = db
        self._collection_name = "participant_registry"
    
    def _redis_key(self, session_id: str) -> str:
        return f"{self.REDIS_KEY_PREFIX}:{session_id}"
    
    async def initialize(
        self,
        session_id: str,
        experiment_id: str,
        user_id: str,
        url_params: Dict[str, str],
        user_agent: Optional[str] = None,
        screen_size: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Initialize participant registry for a new session"""
        state = {
            "session_id": session_id,
            "experiment_id": experiment_id,
            "user_id": user_id,
            "participant": {},
            "environment": {
                "user_agent": user_agent,
                "screen_size": screen_size,
                "device": self._detect_device(user_agent),
                "browser": self._detect_browser(user_agent),
                "started_at": datetime.utcnow().isoformat(),
            },
            "responses": {},
            "scores": {},
            "assignments": {},
            "metadata": {
                "url_params": url_params,
                "created_at": datetime.utcnow().isoformat(),
            }
        }
        
        # Save to Redis for fast access
        redis = get_redis()
        await redis.setex(
            self._redis_key(session_id),
            self.REDIS_TTL,
            json.dumps(state, default=str),
        )
        
        # Persist to MongoDB
        if self.db is not None:
            collection = self.db[self._collection_name]
            await collection.update_one(
                {"session_id": session_id},
                {"$set": state},
                upsert=True,
            )
        
        return state
    
    async def get(self, session_id: str) -> Optional[Dict[str, Any]]:
        """Get full participant state"""
        redis = get_redis()
        
        # Try Redis first
        cached = await redis.get(self._redis_key(session_id))
        if cached:
            return json.loads(cached)
        
        # Fall back to MongoDB
        if self.db is not None:
            collection = self.db[self._collection_name]
            doc = await collection.find_one({"session_id": session_id})
            if doc:
                doc.pop("_id", None)
                # Re-cache in Redis
                await redis.setex(
                    self._redis_key(session_id),
                    self.REDIS_TTL,
                    json.dumps(doc, default=str),
                )
                return doc
        
        return None
    
    async def get_value(self, session_id: str, path: str) -> Any:
        """
        Get a specific value using dot notation path.
        Example: get_value(session_id, "participant.age")
        """
        state = await self.get(session_id)
        if not state:
            return None
        
        return self._get_nested(state, path.split("."))
    
    async def set_value(
        self,
        session_id: str,
        path: str,
        value: Any,
        persist: bool = True,
    ) -> None:
        """
        Set a specific value using dot notation path.
        Example: set_value(session_id, "participant.age", 25)
        """
        state = await self.get(session_id)
        if not state:
            logger.warning(f"Cannot set value - session {session_id} not found")
            return
        
        # Update nested value
        self._set_nested(state, path.split("."), value)
        state["metadata"]["updated_at"] = datetime.utcnow().isoformat()
        
        # Save to Redis
        redis = get_redis()
        await redis.setex(
            self._redis_key(session_id),
            self.REDIS_TTL,
            json.dumps(state, default=str),
        )
        
        # Persist to MongoDB if requested
        if persist and self.db is not None:
            collection = self.db[self._collection_name]
            await collection.update_one(
                {"session_id": session_id},
                {"$set": {path: value, "metadata.updated_at": datetime.utcnow()}},
            )
    
    async def add_response(
        self,
        session_id: str,
        stage_id: str,
        data: Dict[str, Any],
    ) -> None:
        """Add stage response data to registry"""
        await self.set_value(session_id, f"responses.{stage_id}", data)
    
    async def update_score(
        self,
        session_id: str,
        score_name: str,
        value: Any,
    ) -> None:
        """Update a computed score"""
        await self.set_value(session_id, f"scores.{score_name}", value)
    
    async def add_assignment(
        self,
        session_id: str,
        level_id: str,
        assigned_child_id: str,
        reason: Optional[str] = None,
    ) -> None:
        """Record a balanced/weighted assignment"""
        assignment = {
            "child_id": assigned_child_id,
            "timestamp": datetime.utcnow().isoformat(),
            "reason": reason,
        }
        await self.set_value(session_id, f"assignments.{level_id}", assignment)
    
    async def get_assignment(self, session_id: str, level_id: str) -> Optional[str]:
        """Get previously assigned child ID for a level"""
        assignment = await self.get_value(session_id, f"assignments.{level_id}")
        if assignment and isinstance(assignment, dict):
            return assignment.get("child_id")
        return None
    
    async def build_visibility_context(self, session_id: str) -> Dict[str, Any]:
        """
        Build context dictionary for visibility rule evaluation.
        This is the interface between ParticipantRegistry and VisibilityEngine.
        """
        state = await self.get(session_id)
        if not state:
            return {"session": {}, "url_params": {}, "scores": {}}
        
        return {
            "session": state.get("responses", {}),
            "participant": state.get("participant", {}),
            "url_params": state.get("metadata", {}).get("url_params", {}),
            "scores": state.get("scores", {}),
            "assignments": {
                k: v.get("child_id") if isinstance(v, dict) else v
                for k, v in state.get("assignments", {}).items()
            },
            "environment": state.get("environment", {}),
        }
    
    async def delete(self, session_id: str) -> None:
        """Delete participant registry (for cleanup)"""
        redis = get_redis()
        await redis.delete(self._redis_key(session_id))
        
        if self.db is not None:
            collection = self.db[self._collection_name]
            await collection.delete_one({"session_id": session_id})
    
    # =========================================================================
    # Helper Methods
    # =========================================================================
    
    def _get_nested(self, data: Dict, path_parts: List[str]) -> Any:
        """Get nested value from dictionary"""
        current = data
        for part in path_parts:
            if isinstance(current, dict):
                current = current.get(part)
            else:
                return None
            if current is None:
                return None
        return current
    
    def _set_nested(self, data: Dict, path_parts: List[str], value: Any) -> None:
        """Set nested value in dictionary"""
        current = data
        for part in path_parts[:-1]:
            if part not in current:
                current[part] = {}
            current = current[part]
        current[path_parts[-1]] = value
    
    def _detect_device(self, user_agent: Optional[str]) -> str:
        """Simple device detection from user agent"""
        if not user_agent:
            return "unknown"
        
        ua_lower = user_agent.lower()
        if "mobile" in ua_lower or "android" in ua_lower:
            return "mobile"
        elif "tablet" in ua_lower or "ipad" in ua_lower:
            return "tablet"
        return "desktop"
    
    def _detect_browser(self, user_agent: Optional[str]) -> str:
        """Simple browser detection from user agent"""
        if not user_agent:
            return "unknown"
        
        ua_lower = user_agent.lower()
        if "chrome" in ua_lower:
            return "chrome"
        elif "firefox" in ua_lower:
            return "firefox"
        elif "safari" in ua_lower:
            return "safari"
        elif "edge" in ua_lower:
            return "edge"
        return "other"


# Index creation
async def create_participant_registry_indexes(db: AsyncIOMotorDatabase):
    """Create indexes for participant registry"""
    collection = db["participant_registry"]
    
    await collection.create_index("session_id", unique=True)
    await collection.create_index([
        ("experiment_id", 1),
        ("metadata.created_at", -1),
    ])

