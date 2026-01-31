"""
B-IRES Backend - Main FastAPI Application
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse
import logging
import sys

from app.core.config import settings
from app.core.database import connect_db, disconnect_db
from app.core.redis_client import connect_redis, disconnect_redis
from app.core.object_store import init_object_store

from app.api import auth, experiments, sessions, logs, assets, users, export, monitoring, proxy, external_tasks, external_tasks_ws, templates

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifecycle management"""
    logger.info("Starting B-IRES backend application...")
    logger.info(f"Environment: {settings.ENVIRONMENT}")
    logger.info(f"Debug mode: {settings.DEBUG}")
    
    try:
        # Startup
        logger.info("Initializing database connection...")
        await connect_db()
        
        logger.info("Initializing Redis connection...")
        await connect_redis()
        
        logger.info("Initializing object store...")
        await init_object_store()
        
        logger.info("All services initialized successfully")
        
        yield
        
        # Shutdown
        logger.info("Shutting down application...")
        await disconnect_db()
        await disconnect_redis()
        logger.info("Shutdown complete")
    except Exception as e:
        logger.error(f"Failed to start application: {e}", exc_info=True)
        raise


app = FastAPI(
    title="B-IRES API",
    description="Bar-Ilan Research Evaluation System - Backend API",
    version="1.0.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
    docs_url="/api/docs" if settings.ENVIRONMENT == "development" else None,
    redoc_url="/api/redoc" if settings.ENVIRONMENT == "development" else None,
)

# CORS configuration
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include API routers
app.include_router(auth.router, prefix="/api/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/api/users", tags=["Users"])
app.include_router(experiments.router, prefix="/api/experiments", tags=["Experiments"])
app.include_router(sessions.router, prefix="/api/sessions", tags=["Sessions"])
app.include_router(logs.router, prefix="/api/logs", tags=["Logging"])
app.include_router(assets.router, prefix="/api/assets", tags=["Assets"])
app.include_router(export.router, prefix="/api/export", tags=["Export"])
app.include_router(monitoring.router, prefix="/api/monitoring", tags=["Monitoring"])
app.include_router(external_tasks.router, prefix="/api/external-tasks", tags=["External Tasks"])
app.include_router(external_tasks_ws.router, prefix="/api", tags=["External Tasks WebSocket"])
app.include_router(proxy.router, tags=["Proxy"])
app.include_router(templates.router, prefix="/api/templates", tags=["Templates"])


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "version": "1.0.0",
        "environment": settings.ENVIRONMENT
    }


@app.get("/")
async def root():
    """Root endpoint redirect info"""
    return {
        "message": "B-IRES API",
        "docs": "/api/docs",
        "health": "/api/health"
    }

