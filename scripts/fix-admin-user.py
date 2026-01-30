#!/usr/bin/env python3
"""
Script to create or update the admin user in the database
This ensures the admin user exists with the correct password hash
"""
import asyncio
import sys
from datetime import datetime
from pathlib import Path

# Add backend to path
backend_path = Path(__file__).parent.parent / "backend"
sys.path.insert(0, str(backend_path))

from app.core.database import connect_db, disconnect_db, get_collection
from app.core.security import get_password_hash, verify_password
from app.core.config import settings


async def fix_admin_user():
    """Create or update admin user with correct password"""
    print("Connecting to MongoDB...")
    await connect_db()
    
    users = get_collection("users")
    
    # Check if admin user exists
    admin_email = "admin@example.com"
    admin_password = "admin123"
    
    existing_user = await users.find_one({"email": admin_email})
    
    if existing_user:
        print(f"Found existing admin user: {admin_email}")
        
        # Test if current password hash works
        current_hash = existing_user.get("hashed_password")
        if current_hash and verify_password(admin_password, current_hash):
            print("✓ Password hash is correct!")
            print(f"User ID: {existing_user['_id']}")
            print(f"Username: {existing_user.get('username', 'N/A')}")
            print(f"Role: {existing_user.get('role', 'N/A')}")
            print(f"Active: {existing_user.get('is_active', False)}")
        else:
            print("✗ Password hash is incorrect. Updating...")
            # Update password hash
            new_hash = get_password_hash(admin_password)
            await users.update_one(
                {"_id": existing_user["_id"]},
                {
                    "$set": {
                        "hashed_password": new_hash,
                        "updated_at": datetime.utcnow(),
                        "is_active": True,
                        "role": "admin"
                    }
                }
            )
            print("✓ Password hash updated successfully!")
    else:
        print(f"Admin user not found. Creating new admin user: {admin_email}")
        
        # Generate password hash
        password_hash = get_password_hash(admin_password)
        
        # Create admin user
        user_doc = {
            "_id": f"admin-{int(datetime.utcnow().timestamp() * 1000)}",
            "email": admin_email,
            "username": "admin",
            "full_name": "System Administrator",
            "role": "admin",
            "is_active": True,
            "hashed_password": password_hash,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
        }
        
        await users.insert_one(user_doc)
        print("✓ Admin user created successfully!")
        print(f"User ID: {user_doc['_id']}")
    
    # Verify the password works
    print("\nVerifying password...")
    user_doc = await users.find_one({"email": admin_email})
    if user_doc and verify_password(admin_password, user_doc["hashed_password"]):
        print("✓ Password verification successful!")
    else:
        print("✗ Password verification failed!")
        sys.exit(1)
    
    print("\n" + "="*50)
    print("Admin user is ready!")
    print(f"Email: {admin_email}")
    print(f"Password: {admin_password}")
    print("="*50)
    
    await disconnect_db()


if __name__ == "__main__":
    asyncio.run(fix_admin_user())



