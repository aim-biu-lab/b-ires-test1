"""
Quota engine for managing stage completion limits
Uses Redis for atomic operations to handle concurrent access
"""
from typing import Optional
import logging

from app.core.redis_client import get_redis, RedisKeys, RedisTTL

logger = logging.getLogger(__name__)


class QuotaEngine:
    """
    Manages quota limits for stages with concurrent access handling.
    Uses atomic Redis operations to prevent race conditions.
    """
    
    async def check_availability(
        self,
        experiment_id: str,
        stage_id: str,
        limit: int,
    ) -> bool:
        """
        Check if a stage slot is available.
        Does NOT reserve the slot.
        """
        redis = get_redis()
        quota_key = RedisKeys.quota(experiment_id, stage_id)
        
        # Get current count
        current = await redis.get(quota_key)
        current_count = int(current) if current else 0
        
        return current_count < limit
    
    async def try_reserve(
        self,
        experiment_id: str,
        stage_id: str,
        session_id: str,
        limit: int,
        ttl_seconds: int = RedisTTL.QUOTA_RESERVATION,
    ) -> bool:
        """
        Try to reserve a quota slot for a session.
        Uses atomic operations to prevent race conditions.
        Returns True if reservation successful, False if quota full.
        """
        redis = get_redis()
        quota_key = RedisKeys.quota(experiment_id, stage_id)
        reservation_key = RedisKeys.quota_reservation(experiment_id, stage_id, session_id)
        
        # Check if already reserved by this session
        existing = await redis.get(reservation_key)
        if existing:
            return True  # Already has a reservation
        
        # Use Lua script for atomic check-and-increment
        lua_script = """
        local quota_key = KEYS[1]
        local reservation_key = KEYS[2]
        local limit = tonumber(ARGV[1])
        local ttl = tonumber(ARGV[2])
        
        local current = redis.call('GET', quota_key)
        current = current and tonumber(current) or 0
        
        if current < limit then
            -- Still under limit, make reservation
            redis.call('SET', reservation_key, '1', 'EX', ttl)
            return 1
        else
            return 0
        end
        """
        
        result = await redis.eval(
            lua_script,
            2,
            quota_key,
            reservation_key,
            limit,
            ttl_seconds
        )
        
        return result == 1
    
    async def try_complete(
        self,
        experiment_id: str,
        stage_id: str,
        session_id: str,
    ) -> bool:
        """
        Complete a stage and convert reservation to completion.
        Increments the completion counter atomically.
        Returns True if completion recorded, False if something went wrong.
        """
        redis = get_redis()
        quota_key = RedisKeys.quota(experiment_id, stage_id)
        reservation_key = RedisKeys.quota_reservation(experiment_id, stage_id, session_id)
        
        # Use Lua script for atomic reservation-to-completion
        lua_script = """
        local quota_key = KEYS[1]
        local reservation_key = KEYS[2]
        
        -- Check if has reservation (or just allow completion)
        local has_reservation = redis.call('GET', reservation_key)
        
        -- Increment completion counter
        redis.call('INCR', quota_key)
        
        -- Remove reservation if existed
        if has_reservation then
            redis.call('DEL', reservation_key)
        end
        
        return 1
        """
        
        result = await redis.eval(
            lua_script,
            2,
            quota_key,
            reservation_key
        )
        
        return result == 1
    
    async def release_reservation(
        self,
        experiment_id: str,
        stage_id: str,
        session_id: str,
    ) -> bool:
        """
        Release a reservation without completing.
        Called when user times out or abandons.
        """
        redis = get_redis()
        reservation_key = RedisKeys.quota_reservation(experiment_id, stage_id, session_id)
        
        result = await redis.delete(reservation_key)
        return result > 0
    
    async def get_status(
        self,
        experiment_id: str,
        stage_id: str,
        limit: int,
    ) -> dict:
        """Get quota status for monitoring"""
        redis = get_redis()
        quota_key = RedisKeys.quota(experiment_id, stage_id)
        
        current = await redis.get(quota_key)
        current_count = int(current) if current else 0
        
        # Count active reservations
        reservation_pattern = RedisKeys.quota_reservation(experiment_id, stage_id, "*")
        reservation_keys = []
        async for key in redis.scan_iter(match=reservation_pattern):
            reservation_keys.append(key)
        
        return {
            "experiment_id": experiment_id,
            "stage_id": stage_id,
            "limit": limit,
            "completed": current_count,
            "reserved": len(reservation_keys),
            "available": max(0, limit - current_count - len(reservation_keys)),
            "is_full": current_count >= limit,
        }
    
    async def reset_quota(
        self,
        experiment_id: str,
        stage_id: str,
    ) -> bool:
        """Reset quota counter (admin function)"""
        redis = get_redis()
        quota_key = RedisKeys.quota(experiment_id, stage_id)
        
        await redis.delete(quota_key)
        
        # Also clear any reservations
        reservation_pattern = RedisKeys.quota_reservation(experiment_id, stage_id, "*")
        async for key in redis.scan_iter(match=reservation_pattern):
            await redis.delete(key)
        
        return True



