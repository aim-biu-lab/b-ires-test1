"""
Redis client for sessions, caching, and quota management
"""
import redis.asyncio as redis
from typing import Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class RedisClient:
    """Redis connection manager"""
    
    client: Optional[redis.Redis] = None


redis_client = RedisClient()


async def connect_redis():
    """Connect to Redis"""
    logger.info(f"Connecting to Redis at {settings.REDIS_URL}")
    
    try:
        redis_client.client = redis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=30,
            socket_timeout=30
        )
        
        # Test connection
        await redis_client.client.ping()
        
        logger.info("Redis connection established")
    except Exception as e:
        logger.error(f"Failed to connect to Redis: {e}")
        logger.error(f"Redis URL: {settings.REDIS_URL}")
        raise


async def disconnect_redis():
    """Close Redis connection"""
    if redis_client.client:
        await redis_client.client.close()
        logger.info("Redis connection closed")


def get_redis() -> redis.Redis:
    """Get Redis client instance"""
    return redis_client.client


# Key prefixes for different data types
class RedisKeys:
    """Redis key naming conventions"""
    
    @staticmethod
    def session(session_id: str) -> str:
        return f"session:{session_id}"
    
    @staticmethod
    def session_state(session_id: str) -> str:
        return f"session:{session_id}:state"
    
    @staticmethod
    def idempotency(key: str) -> str:
        return f"idem:{key}"
    
    @staticmethod
    def quota(experiment_id: str, stage_id: str) -> str:
        return f"quota:{experiment_id}:{stage_id}"
    
    @staticmethod
    def quota_reservation(experiment_id: str, stage_id: str, session_id: str) -> str:
        return f"quota:{experiment_id}:{stage_id}:reserved:{session_id}"
    
    @staticmethod
    def rate_limit(user_id: str) -> str:
        return f"ratelimit:{user_id}"
    
    @staticmethod
    def cache(key: str) -> str:
        return f"cache:{key}"
    
    @staticmethod
    def user_session(user_id: str) -> str:
        return f"user_sessions:{user_id}"


# TTL constants (in seconds)
class RedisTTL:
    """TTL values for different data types"""
    
    SESSION = 86400  # 24 hours
    IDEMPOTENCY = 86400  # 24 hours
    QUOTA_RESERVATION = 1800  # 30 minutes
    RATE_LIMIT = 60  # 1 minute
    CACHE_SHORT = 300  # 5 minutes
    CACHE_MEDIUM = 3600  # 1 hour
    CACHE_LONG = 86400  # 24 hours



