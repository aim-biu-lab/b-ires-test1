"""
Object storage client (MinIO/S3) for assets and log backups
"""
from minio import Minio
from minio.error import S3Error
from typing import Optional, BinaryIO
from datetime import timedelta
import logging
import io

from app.core.config import settings

logger = logging.getLogger(__name__)


class ObjectStore:
    """MinIO/S3 object storage manager"""
    
    client: Optional[Minio] = None


object_store = ObjectStore()


async def init_object_store():
    """Initialize MinIO client and ensure buckets exist"""
    logger.info(f"Connecting to MinIO at {settings.MINIO_ENDPOINT}")
    
    object_store.client = Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE
    )
    
    # Ensure buckets exist
    for bucket in [settings.MINIO_BUCKET, settings.MINIO_LOGS_BUCKET]:
        try:
            if not object_store.client.bucket_exists(bucket):
                object_store.client.make_bucket(bucket)
                logger.info(f"Created bucket: {bucket}")
        except S3Error as e:
            logger.error(f"Error creating bucket {bucket}: {e}")
    
    logger.info("MinIO object store initialized")


def get_object_store() -> Minio:
    """Get MinIO client instance"""
    return object_store.client


async def upload_file(
    bucket: str,
    object_name: str,
    data: BinaryIO,
    content_type: str,
    size: int
) -> str:
    """Upload a file to object storage"""
    try:
        object_store.client.put_object(
            bucket,
            object_name,
            data,
            size,
            content_type=content_type
        )
        return object_name
    except S3Error as e:
        logger.error(f"Error uploading file: {e}")
        raise


async def upload_bytes(
    bucket: str,
    object_name: str,
    data: bytes,
    content_type: str
) -> str:
    """Upload bytes to object storage"""
    try:
        object_store.client.put_object(
            bucket,
            object_name,
            io.BytesIO(data),
            len(data),
            content_type=content_type
        )
        return object_name
    except S3Error as e:
        logger.error(f"Error uploading bytes: {e}")
        raise


async def get_file(bucket: str, object_name: str) -> bytes:
    """Get a file from object storage"""
    try:
        response = object_store.client.get_object(bucket, object_name)
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except S3Error as e:
        logger.error(f"Error getting file: {e}")
        raise


async def get_file_stat(bucket: str, object_name: str):
    """Get file metadata (size, content_type, etc.) without downloading"""
    try:
        stat = object_store.client.stat_object(bucket, object_name)
        return {
            "size": stat.size,
            "content_type": stat.content_type,
            "etag": stat.etag,
            "last_modified": stat.last_modified,
        }
    except S3Error as e:
        logger.error(f"Error getting file stat: {e}")
        raise


async def get_file_range(bucket: str, object_name: str, start: int, end: int):
    """Get a byte range from a file (for streaming/Range requests)"""
    try:
        length = end - start + 1
        response = object_store.client.get_object(
            bucket, 
            object_name,
            offset=start,
            length=length
        )
        data = response.read()
        response.close()
        response.release_conn()
        return data
    except S3Error as e:
        logger.error(f"Error getting file range: {e}")
        raise


async def delete_file(bucket: str, object_name: str) -> bool:
    """Delete a file from object storage"""
    try:
        object_store.client.remove_object(bucket, object_name)
        return True
    except S3Error as e:
        logger.error(f"Error deleting file: {e}")
        raise


async def get_presigned_url(
    bucket: str,
    object_name: str,
    expires: timedelta = timedelta(hours=1)
) -> str:
    """Generate a presigned URL for temporary access"""
    try:
        return object_store.client.presigned_get_object(
            bucket,
            object_name,
            expires=expires
        )
    except S3Error as e:
        logger.error(f"Error generating presigned URL: {e}")
        raise


async def list_objects(bucket: str, prefix: str = "") -> list:
    """List objects in a bucket with optional prefix"""
    try:
        objects = object_store.client.list_objects(bucket, prefix=prefix)
        return [obj.object_name for obj in objects]
    except S3Error as e:
        logger.error(f"Error listing objects: {e}")
        raise


async def file_exists(bucket: str, object_name: str) -> bool:
    """Check if a file exists in object storage"""
    try:
        object_store.client.stat_object(bucket, object_name)
        return True
    except S3Error:
        return False


