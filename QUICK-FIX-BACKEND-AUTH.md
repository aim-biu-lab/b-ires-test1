# QUICK FIX: Backend "Authentication Required" Error

## Your Error
```
pymongo.errors.OperationFailure: Command createIndexes requires authentication
```

## What's Wrong
The MongoDB user credentials in your `.env` file don't match what's actually in MongoDB. This happens because MongoDB only runs the initialization script THE FIRST TIME it starts.

## How to Fix (3 Steps)

### Step 1: Pull Latest Code
```bash
cd /home/bires/bires
git pull origin master
```

### Step 2: Run the Fix Script
```bash
bash scripts/fix-mongo-user.sh
```

This will:
- Test your MongoDB admin password
- Update the MongoDB user with the password from `.env`
- Verify the fix worked

### Step 3: Restart Backend
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend
```

### Step 4: Verify It Works
```bash
# Should show "healthy"
curl http://localhost:8000/api/health

# Check logs
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend --tail=50
```

## If That Doesn't Work

### Option A: Diagnose First
```bash
bash scripts/diagnose-backend.sh
```

This will tell you exactly what's wrong.

### Option B: Manual Fix
```bash
# Load your environment variables
source .env

# Connect to MongoDB
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec mongo mongosh -u admin -p "${MONGO_ADMIN_PASSWORD}"

# Inside MongoDB shell:
use admin;
db.dropUser('bires_admin');  // or whatever your MONGO_USER is
db.createUser({
  user: 'bires_admin',
  pwd: 'YOUR_MONGO_PASSWORD_FROM_ENV',
  roles: [
    { role: 'readWrite', db: 'bires' },
    { role: 'dbAdmin', db: 'bires' }
  ]
});
exit

# Restart backend
docker compose -f docker-compose.yml -f docker-compose.prod.yml restart backend
```

### Option C: Nuclear Option (⚠️ DELETES ALL DATA)
If nothing works and you don't care about losing existing data:

```bash
cd /home/bires/bires

# Stop everything
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Remove MongoDB volume
docker volume rm bires_mongo_data

# Start again (initialization will run fresh)
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Common Issues

### "Cannot connect as root admin"
Your `MONGO_ADMIN_PASSWORD` in `.env` doesn't match what's in MongoDB.

**Fix:** Check what password MongoDB was initialized with.

### "User created but still can't connect"
Your `MONGO_URL` in `.env` might be wrong.

**Should be:**
```bash
MONGO_URL=mongodb://bires_admin:YOUR_PASSWORD@mongo:27017/bires?authSource=admin
```

**Check it:**
```bash
grep MONGO_URL .env
```

## After Fixing

Once the backend starts successfully, you should see:
```
Starting B-IRES backend application...
Initializing database connection...
MongoDB connection successful
Initializing Redis connection...
Redis connection established
Initializing object store...
MinIO connection successful
All services initialized successfully
```

And `curl http://localhost:8000/api/health` should return:
```json
{
  "status": "healthy",
  "version": "1.0.0",
  "environment": "production"
}
```

## Need More Help?

See the complete troubleshooting guide:
```bash
cat docs/troubleshooting-backend-startup.md
```
