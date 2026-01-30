"""
Log exporter for async backup to S3/MinIO
"""
from typing import Dict, List, Any
import json
import logging
from datetime import datetime

from app.core.config import settings
from app.core.object_store import upload_bytes

logger = logging.getLogger(__name__)


class LogExporter:
    """
    Handles async export of events to S3/MinIO for backup.
    Uses JSON Lines format for efficient appending.
    """
    
    @staticmethod
    async def export_event_to_s3(event: Dict[str, Any]):
        """Export a single event to S3"""
        try:
            experiment_id = event.get("experiment_id", "unknown")
            session_id = event.get("session_id", "unknown")
            
            # Build object key
            date_str = datetime.utcnow().strftime("%Y/%m/%d")
            object_key = f"events/{experiment_id}/{date_str}/{session_id}.jsonl"
            
            # Convert event to JSON line
            event_line = json.dumps(event, default=str) + "\n"
            
            # Upload to S3
            await upload_bytes(
                bucket=settings.MINIO_LOGS_BUCKET,
                object_name=object_key,
                data=event_line.encode("utf-8"),
                content_type="application/x-ndjson",
            )
            
        except Exception as e:
            logger.error(f"Failed to export event to S3: {e}")
    
    @staticmethod
    async def export_events_batch_to_s3(events: List[Dict[str, Any]]):
        """Export a batch of events to S3"""
        if not events:
            return
        
        try:
            # Group events by experiment and session
            grouped: Dict[str, Dict[str, List[Dict]]] = {}
            
            for event in events:
                exp_id = event.get("experiment_id", "unknown")
                session_id = event.get("session_id", "unknown")
                
                if exp_id not in grouped:
                    grouped[exp_id] = {}
                if session_id not in grouped[exp_id]:
                    grouped[exp_id][session_id] = []
                
                grouped[exp_id][session_id].append(event)
            
            # Export each group
            date_str = datetime.utcnow().strftime("%Y/%m/%d")
            
            for exp_id, sessions in grouped.items():
                for session_id, session_events in sessions.items():
                    object_key = f"events/{exp_id}/{date_str}/{session_id}.jsonl"
                    
                    # Convert events to JSON lines
                    lines = [json.dumps(e, default=str) for e in session_events]
                    content = "\n".join(lines) + "\n"
                    
                    await upload_bytes(
                        bucket=settings.MINIO_LOGS_BUCKET,
                        object_name=object_key,
                        data=content.encode("utf-8"),
                        content_type="application/x-ndjson",
                    )
            
        except Exception as e:
            logger.error(f"Failed to export event batch to S3: {e}")
    
    @staticmethod
    async def export_session_complete(session: Dict[str, Any]):
        """Export complete session data when session is finished"""
        try:
            experiment_id = session.get("experiment_id", "unknown")
            session_id = session.get("session_id", "unknown")
            
            # Build object key
            date_str = datetime.utcnow().strftime("%Y/%m/%d")
            object_key = f"sessions/{experiment_id}/{date_str}/{session_id}.json"
            
            # Convert session to JSON
            content = json.dumps(session, default=str, indent=2)
            
            await upload_bytes(
                bucket=settings.MINIO_LOGS_BUCKET,
                object_name=object_key,
                data=content.encode("utf-8"),
                content_type="application/json",
            )
            
        except Exception as e:
            logger.error(f"Failed to export session to S3: {e}")



