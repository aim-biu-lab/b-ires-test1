"""
User management API routes (admin only)
"""
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, HTTPException, status, Depends, Query
from uuid import uuid4
import logging

from app.core.database import get_collection
from app.core.security import (
    get_password_hash,
    get_current_user,
    require_admin,
)
from app.models.user import (
    UserCreate,
    UserUpdate,
    UserInDB,
    UserResponse,
    UserRole,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.get("", response_model=List[UserResponse])
async def list_users(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    role: Optional[UserRole] = None,
    is_active: Optional[bool] = None,
    current_user: UserInDB = Depends(require_admin),
):
    """List all users (admin only)"""
    users = get_collection("users")
    
    # Build query
    query = {}
    if role:
        query["role"] = role.value
    if is_active is not None:
        query["is_active"] = is_active
    
    cursor = users.find(query).skip(skip).limit(limit).sort("created_at", -1)
    
    result = []
    async for user_doc in cursor:
        result.append(UserResponse(
            id=user_doc["_id"],
            email=user_doc["email"],
            username=user_doc["username"],
            full_name=user_doc.get("full_name"),
            role=UserRole(user_doc["role"]),
            is_active=user_doc["is_active"],
            created_at=user_doc["created_at"],
            updated_at=user_doc["updated_at"],
            last_login=user_doc.get("last_login"),
        ))
    
    return result


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: str,
    current_user: UserInDB = Depends(require_admin),
):
    """Get a specific user (admin only)"""
    users = get_collection("users")
    
    user_doc = await users.find_one({"_id": user_id})
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return UserResponse(
        id=user_doc["_id"],
        email=user_doc["email"],
        username=user_doc["username"],
        full_name=user_doc.get("full_name"),
        role=UserRole(user_doc["role"]),
        is_active=user_doc["is_active"],
        created_at=user_doc["created_at"],
        updated_at=user_doc["updated_at"],
        last_login=user_doc.get("last_login"),
    )


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_data: UserCreate,
    current_user: UserInDB = Depends(require_admin),
):
    """Create a new user (admin only)"""
    users = get_collection("users")
    
    # Check if email already exists
    existing_email = await users.find_one({"email": user_data.email})
    if existing_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Check if username already exists
    existing_username = await users.find_one({"username": user_data.username})
    if existing_username:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Username already taken"
        )
    
    # Create user document
    user_id = str(uuid4())
    now = datetime.utcnow()
    
    user_doc = {
        "_id": user_id,
        "email": user_data.email,
        "username": user_data.username,
        "full_name": user_data.full_name,
        "role": user_data.role.value,
        "is_active": user_data.is_active,
        "hashed_password": get_password_hash(user_data.password),
        "created_at": now,
        "updated_at": now,
    }
    
    await users.insert_one(user_doc)
    
    return UserResponse(
        id=user_id,
        email=user_data.email,
        username=user_data.username,
        full_name=user_data.full_name,
        role=user_data.role,
        is_active=user_data.is_active,
        created_at=now,
        updated_at=now,
    )


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str,
    user_update: UserUpdate,
    current_user: UserInDB = Depends(require_admin),
):
    """Update a user (admin only)"""
    users = get_collection("users")
    
    # Check if user exists
    user_doc = await users.find_one({"_id": user_id})
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    # Build update document
    update_data = {}
    
    if user_update.email is not None:
        # Check if email is taken by another user
        existing = await users.find_one({
            "email": user_update.email,
            "_id": {"$ne": user_id}
        })
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already in use"
            )
        update_data["email"] = user_update.email
    
    if user_update.username is not None:
        # Check if username is taken by another user
        existing = await users.find_one({
            "username": user_update.username,
            "_id": {"$ne": user_id}
        })
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already in use"
            )
        update_data["username"] = user_update.username
    
    if user_update.full_name is not None:
        update_data["full_name"] = user_update.full_name
    
    if user_update.role is not None:
        update_data["role"] = user_update.role.value
    
    if user_update.is_active is not None:
        update_data["is_active"] = user_update.is_active
    
    if user_update.password is not None:
        update_data["hashed_password"] = get_password_hash(user_update.password)
    
    if update_data:
        update_data["updated_at"] = datetime.utcnow()
        await users.update_one(
            {"_id": user_id},
            {"$set": update_data}
        )
    
    # Get updated user
    updated_user = await users.find_one({"_id": user_id})
    
    return UserResponse(
        id=updated_user["_id"],
        email=updated_user["email"],
        username=updated_user["username"],
        full_name=updated_user.get("full_name"),
        role=UserRole(updated_user["role"]),
        is_active=updated_user["is_active"],
        created_at=updated_user["created_at"],
        updated_at=updated_user["updated_at"],
        last_login=updated_user.get("last_login"),
    )


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: str,
    current_user: UserInDB = Depends(require_admin),
):
    """Delete a user (admin only)"""
    users = get_collection("users")
    
    # Prevent self-deletion
    if user_id == current_user.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Cannot delete your own account"
        )
    
    result = await users.delete_one({"_id": user_id})
    
    if result.deleted_count == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )



