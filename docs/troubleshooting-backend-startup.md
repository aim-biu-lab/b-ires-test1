# Backend Startup Troubleshooting Guide

## Problem Description

When running the installation script, you may encounter this error:

```
[INFO] Waiting for backend to be ready...
[ERROR] Backend failed to start within 120 seconds
```

This guide explains what causes this error and how to fix it.

## What Was Fixed

### 1. **Misleading Error Message** ✅ FIXED
- **Issue**: The error said "120 seconds" but actually waited 360 seconds (120 iterations × 3 seconds)
- **Fix**: Corrected the logic to actually wait 180 seconds (60 iterations × 3 seconds) and show accurate progress messages

### 2. **Improved Error Reporting** ✅ FIXED
- **Issue**: No detailed information about what failed
- **Fix**: Now shows:
  - Detailed backend logs (last 100 lines)
  - Container status
  - Troubleshooting tips for common issues
  - Progress updates every 30 seconds

### 3. **Better Connection Timeout Handling** ✅ FIXED
- **Issue**: MongoDB, Redis, and MinIO connections had no timeout settings
- **Fix**: Added explicit timeout settings (30 seconds) for all connections with proper error logging

### 4. **Enhanced Startup Logging** ✅ FIXED
- **Issue**: Backend startup was silent, making it hard to diagnose issues
- **Fix**: Added detailed logging for each startup step:
  - MongoDB connection and authentication
  - Redis connection and authentication
  - MinIO connection and bucket verification
  - Clear error messages with connection details

## Common Causes and Solutions

### Cause 1: MongoDB Authentication Failed

**Symptoms:**
- Backend logs show "Failed to connect to MongoDB"
- Error mentions "Command createIndexes requires authentication"
- Error code 13 (Unauthorized)

**Root Cause:**
The MongoDB initialization script only runs the FIRST time MongoDB starts. If:
- MongoDB was initialized before with different credentials
- You changed the `.env` file after MongoDB was created
- The initialization ran without proper environment variables

Then the MongoDB user credentials don't match your `.env` file!

**Quick Test:**
```bash
# Test if the credentials in .env work
source .env
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec mongo mongosh \
  -u "${MONGO_USER}" -p "${MONGO_PASSWORD}" \
  --authenticationDatabase admin \
  --eval "db.adminCommand('ping')"
```

If this fails with "Authentication failed", your credentials don't match!

**Solution: Use the MongoDB Fix Script**
```bash
cd /path/to/bires
bash scripts/fix-mongo-user.sh
```

This script will:
1. Check if MongoDB is running
2. Test the root and application user connections
3. Update/recreate the MongoDB user with credentials from `.env`
4. Verify the fix worked

**Manual Fix (if script doesn't work):**
```bash
# 1. Connect to MongoDB as admin
docker compose exec mongo mongosh -u admin -p <MONGO_ADMIN_PASSWORD>

# 2. Switch to admin database
use admin;

# 3. Drop old user (if exists)
db.dropUser('bires_admin');

# 4. Create new user with correct credentials
db.createUser({
  user: 'bires_admin',
  pwd: 'YOUR_PASSWORD_FROM_ENV',
  roles: [
    { role: 'readWrite', db: 'bires' },
    { role: 'dbAdmin', db: 'bires' }
  ]
});

# 5. Exit and restart backend
exit
docker compose restart backend
```

**Nuclear Option (WARNING: Deletes all data):**
If nothing else works, recreate MongoDB from scratch:
```bash
# Stop and remove MongoDB volume
docker compose down
docker volume rm bires_mongo_data

# Restart - initialization will run again
docker compose up -d
```

### Cause 2: Redis Authentication Failed

**Symptoms:**
- Backend logs show "Failed to connect to Redis"
- Error mentions NOAUTH or authentication required

**Solution:**
```bash
# Check Redis password in .env file
cat .env | grep REDIS_PASSWORD

# Test Redis connection
docker compose exec redis redis-cli -a <REDIS_PASSWORD> ping
```

**Fix:**
- Ensure `REDIS_PASSWORD` in `.env` matches the password in `docker-compose.prod.yml`
- Format must be: `redis://:password@redis:6379`

### Cause 3: MinIO Not Ready

**Symptoms:**
- Backend logs show "Failed to connect to MinIO" or "Failed to initialize object store"

**Solution:**
```bash
# Check MinIO status
docker compose ps minio

# Check MinIO logs
docker compose logs minio

# Verify minio-init completed
docker compose logs minio-init
```

**Fix:**
- Wait for minio-init container to complete bucket creation
- Verify `MINIO_ACCESS_KEY` and `MINIO_SECRET_KEY` in `.env`

### Cause 4: Network Issues Between Containers

**Symptoms:**
- Backend can't reach other services
- Connection timeout errors

**Solution:**
```bash
# Test connectivity from backend to other services
docker compose exec backend ping mongo -c 3
docker compose exec backend ping redis -c 3
docker compose exec backend ping minio -c 3
```

**Fix:**
- Restart all services: `docker compose down && docker compose up -d`
- Check Docker network: `docker network ls` and `docker network inspect <network>`

### Cause 5: Slow Index Creation

**Symptoms:**
- Backend starts but takes a very long time
- No errors, just slow startup

**Solution:**
- This is normal on first startup when creating MongoDB indexes
- Wait the full 180 seconds timeout
- Subsequent startups will be faster

## Diagnostic Tools

### 1. Use the Diagnostic Script

Run the comprehensive diagnostic script:

```bash
cd /path/to/bires
bash scripts/diagnose-backend.sh
```

This script checks:
- Container status
- MongoDB connectivity and authentication
- Redis connectivity and authentication
- MinIO connectivity and authentication
- Backend health endpoint
- Network connectivity between containers
- Recent backend logs

### 2. Manual Diagnostics

#### Check all container status:
```bash
docker compose ps
```

#### View backend logs:
```bash
docker compose logs backend --tail=100 -f
```

#### Test health endpoint:
```bash
curl -v http://localhost:8000/api/health
```

#### Check environment variables:
```bash
docker compose exec backend env | grep -E "MONGO|REDIS|MINIO"
```

#### Test MongoDB connection from backend:
```bash
docker compose exec backend python -c "
from app.core.config import settings
print(f'MONGO_URL: {settings.MONGO_URL}')
"
```

## Installation Script Improvements

The deployment module (`scripts/installer/modules/07-deploy-app.sh`) now:

1. **Shows accurate wait times**: "Backend startup timeout: 180 seconds"
2. **Displays progress updates**: Every 30 seconds shows elapsed time
3. **Provides detailed error information**: Shows logs, container status, and troubleshooting tips
4. **Suggests next steps**: Clear guidance on how to diagnose the issue

## Prevention Tips

### Before Installation:
1. Ensure at least 2GB RAM available (4GB recommended)
2. Verify internet connectivity
3. Use fresh `.env` file generated by installer

### During Installation:
1. Don't interrupt the process during backend startup
2. If it fails, use the diagnostic script before retrying
3. Save the logs for troubleshooting

### After Installation:
1. Backup your `.env` file
2. Run the diagnostic script to verify all services
3. Test the health endpoint: `curl http://localhost:8000/api/health`

## Quick Fix Checklist

If backend fails to start, try these in order:

- [ ] Run diagnostic script: `bash scripts/diagnose-backend.sh`
- [ ] Check `.env` file has all required variables
- [ ] Verify all infrastructure containers are running: `docker compose ps`
- [ ] Check backend logs: `docker compose logs backend --tail=100`
- [ ] Restart infrastructure: `docker compose restart mongo redis minio`
- [ ] Restart backend: `docker compose restart backend`
- [ ] If still failing, rebuild: `docker compose up -d --build --force-recreate backend`

## Getting More Help

If you're still experiencing issues after following this guide:

1. **Collect diagnostic information:**
   ```bash
   bash scripts/diagnose-backend.sh > diagnostic-output.txt
   docker compose logs > all-logs.txt
   ```

2. **Check the .env file** (remove sensitive values before sharing):
   ```bash
   cat .env | grep -v PASSWORD | grep -v SECRET
   ```

3. **Verify system requirements:**
   ```bash
   free -h  # Check available RAM
   df -h    # Check disk space
   docker version  # Verify Docker version
   docker compose version  # Verify Docker Compose version
   ```

## Changes Made to Fix This Issue

### Files Modified:

1. **`scripts/installer/modules/07-deploy-app.sh`**
   - Fixed wait time calculation (now actually 180 seconds)
   - Added progress updates every 30 seconds
   - Enhanced error reporting with logs and troubleshooting tips
   - Shows container status when backend fails

2. **`backend/app/core/database.py`**
   - Added explicit connection timeouts (30 seconds)
   - Added connection test with ping command
   - Enhanced error logging with connection details

3. **`backend/app/core/redis_client.py`**
   - Added socket timeouts (30 seconds)
   - Enhanced error logging with connection details

4. **`backend/app/core/object_store.py`**
   - Added connection test (list buckets)
   - Enhanced error logging
   - Better bucket creation error handling

5. **`backend/app/main.py`**
   - Added comprehensive startup logging
   - Shows environment and debug mode
   - Logs each initialization step
   - Better exception handling with stack traces

### Files Created:

1. **`scripts/diagnose-backend.sh`**
   - Comprehensive diagnostic script
   - Tests all service connections
   - Shows recent logs
   - Checks network connectivity

2. **`docs/troubleshooting-backend-startup.md`** (this file)
   - Complete troubleshooting guide
   - Common causes and solutions
   - Diagnostic tools
   - Prevention tips

## Summary

The backend startup issues were caused by:
1. Misleading error messages
2. Lack of detailed diagnostics
3. No connection timeout handling
4. Insufficient logging during startup

All these issues have been fixed, and new diagnostic tools have been added to make troubleshooting easier.
