"""
Asset management API routes
"""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, HTTPException, status, Depends, UploadFile, File, Form, Query, Request, Response
from fastapi.responses import StreamingResponse
from uuid import uuid4
import mimetypes
import io
import logging

from app.core.config import settings
from app.core.database import get_collection
from app.core.security import get_current_user, require_researcher
from app.core.object_store import (
    upload_file,
    get_file,
    get_file_stat,
    get_file_range,
    delete_file,
    get_presigned_url,
    list_objects,
)
from app.models.user import UserInDB, UserRole
from app.models.asset import (
    AssetCreate,
    AssetResponse,
    AssetListResponse,
    AssetUploadResponse,
    AssetType,
)

logger = logging.getLogger(__name__)
router = APIRouter()


def get_asset_type(content_type: str, filename: str) -> AssetType:
    """Determine asset type from content type and filename"""
    if content_type.startswith("image/"):
        return AssetType.IMAGE
    elif content_type.startswith("video/"):
        return AssetType.VIDEO
    elif content_type.startswith("audio/"):
        return AssetType.AUDIO
    elif content_type == "text/html" or filename.endswith(".html"):
        return AssetType.HTML
    elif content_type == "text/css" or filename.endswith(".css"):
        return AssetType.CSS
    elif content_type in ("application/javascript", "text/javascript") or filename.endswith(".js"):
        return AssetType.JAVASCRIPT
    elif content_type == "application/pdf":
        return AssetType.PDF
    elif filename.endswith((".yaml", ".yml")):
        return AssetType.YAML
    elif content_type == "application/json" or filename.endswith(".json"):
        return AssetType.JSON
    else:
        return AssetType.OTHER


def validate_file_extension(filename: str) -> bool:
    """Validate file extension against allowed list"""
    ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    return ext in settings.ALLOWED_UPLOAD_EXTENSIONS


@router.post("/upload", response_model=AssetUploadResponse)
async def upload_asset(
    file: UploadFile = File(...),
    experiment_id: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
    is_shared: bool = Form(False),
    current_user: UserInDB = Depends(require_researcher),
):
    """Upload a new asset"""
    # Validate file extension
    if not validate_file_extension(file.filename):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type not allowed. Allowed: {settings.ALLOWED_UPLOAD_EXTENSIONS}"
        )
    
    # Read file content
    content = await file.read()
    size = len(content)
    
    # Check file size
    max_size = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if size > max_size:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File too large. Maximum size: {settings.MAX_UPLOAD_SIZE_MB}MB"
        )
    
    # Determine content type
    content_type = file.content_type or mimetypes.guess_type(file.filename)[0] or "application/octet-stream"
    asset_type = get_asset_type(content_type, file.filename)
    
    # Generate asset ID and object key
    asset_id = str(uuid4())
    
    # Build object key: experiments/{exp_id}/assets/{asset_id}/{filename} or shared/{asset_id}/{filename}
    if experiment_id:
        object_key = f"experiments/{experiment_id}/assets/{asset_id}/{file.filename}"
    else:
        object_key = f"shared/{asset_id}/{file.filename}"
    
    # Upload to MinIO
    try:
        await upload_file(
            bucket=settings.MINIO_BUCKET,
            object_name=object_key,
            data=io.BytesIO(content),
            content_type=content_type,
            size=size,
        )
    except Exception as e:
        logger.error(f"Failed to upload file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to upload file"
        )
    
    # Create database record
    assets = get_collection("assets")
    now = datetime.utcnow()
    
    asset_doc = {
        "_id": asset_id,
        "asset_id": asset_id,
        "filename": file.filename,
        "content_type": content_type,
        "asset_type": asset_type.value,
        "size": size,
        "object_key": object_key,
        "experiment_id": experiment_id,
        "description": description,
        "is_shared": is_shared,
        "owner_id": current_user.id,
        "created_at": now,
        "updated_at": now,
    }
    
    await assets.insert_one(asset_doc)
    
    # Generate presigned URL
    url = await get_presigned_url(
        bucket=settings.MINIO_BUCKET,
        object_name=object_key,
        expires=timedelta(hours=24),
    )
    
    # Build reference string
    if experiment_id:
        reference = f"asset://{experiment_id}/{file.filename}"
    else:
        reference = f"asset_id:{asset_id}"
    
    return AssetUploadResponse(
        asset_id=asset_id,
        filename=file.filename,
        content_type=content_type,
        size=size,
        url=url,
        reference=reference,
    )


@router.get("", response_model=AssetListResponse)
async def list_assets(
    experiment_id: Optional[str] = None,
    asset_type: Optional[AssetType] = None,
    is_shared: Optional[bool] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    current_user: UserInDB = Depends(get_current_user),
):
    """List assets with filtering"""
    assets = get_collection("assets")
    
    # Build query
    query = {}
    
    if experiment_id:
        query["experiment_id"] = experiment_id
    
    if asset_type:
        query["asset_type"] = asset_type.value
    
    if is_shared is not None:
        query["is_shared"] = is_shared
    
    # Non-admins can only see their own assets or shared assets
    if current_user.role != UserRole.ADMIN:
        query["$or"] = [
            {"owner_id": current_user.id},
            {"is_shared": True}
        ]
    
    # Get total count
    total = await assets.count_documents(query)
    
    # Get paginated results
    skip = (page - 1) * page_size
    cursor = assets.find(query).skip(skip).limit(page_size).sort("created_at", -1)
    
    result = []
    async for asset_doc in cursor:
        # Generate presigned URL
        url = await get_presigned_url(
            bucket=settings.MINIO_BUCKET,
            object_name=asset_doc["object_key"],
            expires=timedelta(hours=1),
        )
        
        result.append(AssetResponse(
            asset_id=asset_doc["asset_id"],
            filename=asset_doc["filename"],
            content_type=asset_doc["content_type"],
            asset_type=AssetType(asset_doc["asset_type"]),
            size=asset_doc["size"],
            experiment_id=asset_doc.get("experiment_id"),
            description=asset_doc.get("description"),
            is_shared=asset_doc["is_shared"],
            url=url,
            created_at=asset_doc["created_at"],
        ))
    
    return AssetListResponse(
        assets=result,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{asset_id}", response_model=AssetResponse)
async def get_asset(
    asset_id: str,
    current_user: UserInDB = Depends(get_current_user),
):
    """Get asset metadata"""
    assets = get_collection("assets")
    
    asset_doc = await assets.find_one({"asset_id": asset_id})
    if not asset_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    # Check access
    if current_user.role != UserRole.ADMIN:
        if asset_doc["owner_id"] != current_user.id and not asset_doc["is_shared"]:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied"
            )
    
    url = await get_presigned_url(
        bucket=settings.MINIO_BUCKET,
        object_name=asset_doc["object_key"],
        expires=timedelta(hours=1),
    )
    
    return AssetResponse(
        asset_id=asset_doc["asset_id"],
        filename=asset_doc["filename"],
        content_type=asset_doc["content_type"],
        asset_type=AssetType(asset_doc["asset_type"]),
        size=asset_doc["size"],
        experiment_id=asset_doc.get("experiment_id"),
        description=asset_doc.get("description"),
        is_shared=asset_doc["is_shared"],
        url=url,
        created_at=asset_doc["created_at"],
    )


CHUNK_SIZE = 1024 * 1024  # 1MB chunks for streaming


@router.get("/{asset_id}/download")
async def download_asset(asset_id: str, request: Request):
    """Download asset file with HTTP Range support (public for experiment participants)"""
    assets = get_collection("assets")
    
    asset_doc = await assets.find_one({"asset_id": asset_id})
    if not asset_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    # Get file metadata from MinIO
    try:
        file_stat = await get_file_stat(
            bucket=settings.MINIO_BUCKET,
            object_name=asset_doc["object_key"],
        )
        file_size = file_stat["size"]
    except Exception as e:
        logger.error(f"Failed to get file stat: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve file info"
        )
    
    content_type = asset_doc["content_type"]
    range_header = request.headers.get("range")
    
    # Handle Range request for streaming/seeking
    if range_header:
        try:
            # Parse Range header (e.g., "bytes=0-1000000")
            range_spec = range_header.replace("bytes=", "")
            range_parts = range_spec.split("-")
            start = int(range_parts[0]) if range_parts[0] else 0
            end = int(range_parts[1]) if range_parts[1] else file_size - 1
            
            # Clamp end to file size
            end = min(end, file_size - 1)
            
            # Get the requested range
            content = await get_file_range(
                bucket=settings.MINIO_BUCKET,
                object_name=asset_doc["object_key"],
                start=start,
                end=end,
            )
            
            content_length = end - start + 1
            
            return Response(
                content=content,
                status_code=206,  # Partial Content
                media_type=content_type,
                headers={
                    "Content-Range": f"bytes {start}-{end}/{file_size}",
                    "Content-Length": str(content_length),
                    "Accept-Ranges": "bytes",
                    "Content-Disposition": f'inline; filename="{asset_doc["filename"]}"',
                    "Cache-Control": "public, max-age=3600",
                }
            )
        except Exception as e:
            logger.error(f"Failed to get file range: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to retrieve file range"
            )
    
    # No Range header - return full file with Accept-Ranges to indicate support
    try:
        content = await get_file(
            bucket=settings.MINIO_BUCKET,
            object_name=asset_doc["object_key"],
        )
    except Exception as e:
        logger.error(f"Failed to get file: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve file"
        )
    
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{asset_doc["filename"]}"',
            "Content-Length": str(file_size),
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=3600",
        }
    )


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_asset_endpoint(
    asset_id: str,
    current_user: UserInDB = Depends(require_researcher),
):
    """Delete an asset"""
    assets = get_collection("assets")
    
    asset_doc = await assets.find_one({"asset_id": asset_id})
    if not asset_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    # Check ownership
    if current_user.role != UserRole.ADMIN and asset_doc["owner_id"] != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied"
        )
    
    # Delete from object storage
    try:
        await delete_file(
            bucket=settings.MINIO_BUCKET,
            object_name=asset_doc["object_key"],
        )
    except Exception as e:
        logger.error(f"Failed to delete file from storage: {e}")
    
    # Delete from database
    await assets.delete_one({"asset_id": asset_id})

