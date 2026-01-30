"""
Authentication API routes
"""
from datetime import datetime, timedelta
from fastapi import APIRouter, HTTPException, status, Depends
from uuid import uuid4
import logging

from app.core.config import settings
from app.core.database import get_collection
from app.core.security import (
    verify_password,
    get_password_hash,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
)
from app.models.user import (
    UserCreate,
    UserInDB,
    UserResponse,
    LoginRequest,
    TokenResponse,
    RefreshTokenRequest,
    UserRole,
)

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def register(user_data: UserCreate):
    """Register a new user"""
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
        "is_active": True,
        "hashed_password": get_password_hash(user_data.password),
        "created_at": now,
        "updated_at": now,
        "last_login": now,
    }
    
    await users.insert_one(user_doc)
    
    # Generate tokens
    token_data = {"sub": user_id, "email": user_data.email, "role": user_data.role.value}
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    user_response = UserResponse(
        id=user_id,
        email=user_data.email,
        username=user_data.username,
        full_name=user_data.full_name,
        role=user_data.role,
        is_active=True,
        created_at=now,
        updated_at=now,
        last_login=now,
    )
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        user=user_response,
    )


@router.post("/login", response_model=TokenResponse)
async def login(credentials: LoginRequest):
    """Login with email and password"""
    users = get_collection("users")
    
    # Find user by email
    user_doc = await users.find_one({"email": credentials.email})
    
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Verify password
    if not verify_password(credentials.password, user_doc["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Check if user is active
    if not user_doc.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Update last login
    now = datetime.utcnow()
    await users.update_one(
        {"_id": user_doc["_id"]},
        {"$set": {"last_login": now}}
    )
    
    # Generate tokens
    token_data = {
        "sub": user_doc["_id"],
        "email": user_doc["email"],
        "role": user_doc["role"]
    }
    access_token = create_access_token(token_data)
    refresh_token = create_refresh_token(token_data)
    
    user_response = UserResponse(
        id=user_doc["_id"],
        email=user_doc["email"],
        username=user_doc["username"],
        full_name=user_doc.get("full_name"),
        role=UserRole(user_doc["role"]),
        is_active=user_doc["is_active"],
        created_at=user_doc["created_at"],
        updated_at=user_doc["updated_at"],
        last_login=now,
    )
    
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        user=user_response,
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(request: RefreshTokenRequest):
    """Refresh access token using refresh token"""
    payload = decode_token(request.refresh_token)
    
    if payload.get("type") != "refresh":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Get user from database
    users = get_collection("users")
    user_doc = await users.find_one({"_id": user_id})
    
    if not user_doc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user_doc.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is disabled",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    # Generate new tokens
    token_data = {
        "sub": user_doc["_id"],
        "email": user_doc["email"],
        "role": user_doc["role"]
    }
    new_access_token = create_access_token(token_data)
    new_refresh_token = create_refresh_token(token_data)
    
    user_response = UserResponse(
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
    
    return TokenResponse(
        access_token=new_access_token,
        refresh_token=new_refresh_token,
        expires_in=settings.JWT_EXPIRATION_HOURS * 3600,
        user=user_response,
    )


@router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: UserInDB = Depends(get_current_user)):
    """Get current user information"""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at,
        updated_at=current_user.updated_at,
        last_login=current_user.last_login,
    )


@router.post("/logout")
async def logout(current_user: UserInDB = Depends(get_current_user)):
    """Logout current user (client should discard tokens)"""
    # In a more sophisticated implementation, we would invalidate
    # the refresh token in Redis/database
    return {"message": "Successfully logged out"}



