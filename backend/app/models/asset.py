"""
Asset models for file management
"""
from datetime import datetime
from typing import Optional, List
from enum import Enum
from pydantic import BaseModel, Field


class AssetType(str, Enum):
    """Asset file types"""
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    HTML = "html"
    CSS = "css"
    JAVASCRIPT = "javascript"
    PDF = "pdf"
    YAML = "yaml"
    JSON = "json"
    OTHER = "other"


class AssetBase(BaseModel):
    """Base asset model"""
    filename: str
    content_type: str
    asset_type: AssetType
    size: int
    experiment_id: Optional[str] = None
    description: Optional[str] = None
    is_shared: bool = False  # Available across experiments


class AssetCreate(BaseModel):
    """Asset creation metadata (file uploaded separately)"""
    experiment_id: Optional[str] = None
    description: Optional[str] = None
    is_shared: bool = False


class AssetInDB(AssetBase):
    """Asset as stored in database"""
    id: str = Field(..., alias="_id")
    asset_id: str
    object_key: str  # Key in object storage
    owner_id: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        populate_by_name = True


class AssetResponse(BaseModel):
    """Asset response model"""
    asset_id: str
    filename: str
    content_type: str
    asset_type: AssetType
    size: int
    experiment_id: Optional[str] = None
    description: Optional[str] = None
    is_shared: bool
    url: str  # Presigned URL for access
    created_at: datetime


class AssetListResponse(BaseModel):
    """Asset list response"""
    assets: List[AssetResponse]
    total: int
    page: int
    page_size: int


class AssetUploadResponse(BaseModel):
    """Response after successful upload"""
    asset_id: str
    filename: str
    content_type: str
    size: int
    url: str
    reference: str  # asset://experiment_id/filename or asset_id



