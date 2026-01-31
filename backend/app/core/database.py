"""
MongoDB database connection and utilities
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import IndexModel, ASCENDING, DESCENDING
from typing import Optional
import logging

from app.core.config import settings

logger = logging.getLogger(__name__)


class Database:
    """MongoDB connection manager"""
    
    client: Optional[AsyncIOMotorClient] = None
    db: Optional[AsyncIOMotorDatabase] = None


database = Database()


async def connect_db():
    """Connect to MongoDB and create indexes"""
    logger.info(f"Connecting to MongoDB at {settings.MONGO_URL}")
    
    try:
        # Create client with timeout settings
        database.client = AsyncIOMotorClient(
            settings.MONGO_URL,
            serverSelectionTimeoutMS=30000,  # 30 seconds
            connectTimeoutMS=30000,
            socketTimeoutMS=30000
        )
        database.db = database.client[settings.MONGO_DB]
        
        # Test connection
        await database.client.admin.command('ping')
        logger.info("MongoDB connection successful")
        
        # Create indexes
        await create_indexes()
        
        logger.info("MongoDB connection established")
    except Exception as e:
        logger.error(f"Failed to connect to MongoDB: {e}")
        logger.error(f"MongoDB URL: {settings.MONGO_URL}")
        raise


async def disconnect_db():
    """Close MongoDB connection"""
    if database.client:
        database.client.close()
        logger.info("MongoDB connection closed")


async def create_indexes():
    """Create database indexes for optimal query performance"""
    db = database.db
    
    # Users collection indexes
    await db.users.create_indexes([
        IndexModel([("email", ASCENDING)], unique=True),
        IndexModel([("username", ASCENDING)], unique=True),
    ])
    
    # Experiments collection indexes
    await db.experiments.create_indexes([
        IndexModel([("experiment_id", ASCENDING)], unique=True),
        IndexModel([("owner_id", ASCENDING)]),
        IndexModel([("status", ASCENDING)]),
        IndexModel([("created_at", DESCENDING)]),
    ])
    
    # Sessions collection indexes
    await db.sessions.create_indexes([
        IndexModel([("session_id", ASCENDING)], unique=True),
        IndexModel([("experiment_id", ASCENDING)]),
        IndexModel([("user_id", ASCENDING)]),
        IndexModel([("status", ASCENDING)]),
        IndexModel([("created_at", DESCENDING)]),
    ])
    
    # Events (logs) collection indexes
    await db.events.create_indexes([
        IndexModel([("idempotency_key", ASCENDING)], unique=True),
        IndexModel([("session_id", ASCENDING)]),
        IndexModel([("experiment_id", ASCENDING)]),
        IndexModel([("stage_id", ASCENDING)]),
        IndexModel([("event_type", ASCENDING)]),
        IndexModel([("timestamp", DESCENDING)]),
    ])
    
    # Assets collection indexes
    await db.assets.create_indexes([
        IndexModel([("asset_id", ASCENDING)], unique=True),
        IndexModel([("experiment_id", ASCENDING)]),
        IndexModel([("created_at", DESCENDING)]),
    ])
    
    logger.info("Database indexes created")


def get_db() -> AsyncIOMotorDatabase:
    """Get database instance"""
    return database.db


def get_collection(name: str):
    """Get a specific collection"""
    return database.db[name]



