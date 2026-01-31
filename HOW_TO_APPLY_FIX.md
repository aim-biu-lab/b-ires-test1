# How to Apply MongoDB Authentication Fix on Server

## Quick Fix Instructions

### Option 1: Re-run the Installer (Recommended)

The installer has been updated with the fixes. Simply re-run it:

```bash
# On your local machine, commit and push the changes
cd /home/oleg/Documents/Projects/LLMs/experiments_platrofm_v1
git add .
git commit -m "Fix MongoDB authentication in production mode"
git push

# On the server, clean up and re-run installer
cd /home/bires/bires
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Re-run the bootstrap installer (it will download the latest code)
curl -fsSL https://raw.githubusercontent.com/aim-biu-lab/b-ires-test1/master/scripts/install.sh | sudo -E bash -s -- --config /path/to/config.txt --non-interactive
```

### Option 2: Manual Fix on Existing Installation

If you want to fix the existing installation without re-running everything:

```bash
# On the server
cd /home/bires/bires

# 1. Pull latest code
git fetch origin
git reset --hard origin/master

# 2. Stop all containers
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# 3. Verify .env file has correct MongoDB URL with authentication
grep "MONGO_URL" .env
# Should show: MONGO_URL=mongodb://bires_admin:PASSWORD@mongo:27017/bires?authSource=admin

# 4. Remove old containers to force recreation
docker compose -f docker-compose.yml -f docker-compose.prod.yml rm -f

# 5. Start services with --force-recreate
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate

# 6. Monitor backend startup
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f backend
```

### Option 3: Quick Test (Check if .env is the Issue)

Test if the issue is just the .env not being loaded:

```bash
# On the server
cd /home/bires/bires

# Check if MONGO_URL in .env has credentials
grep "MONGO_URL" .env

# If it shows: MONGO_URL=mongodb://mongo:27017
# Then the .env was not generated correctly, regenerate it:
source /tmp/bires-installer/lib/config-parser.sh
source /tmp/bires-installer/lib/password-generator.sh
# ... (re-run module 04 manually)

# If it shows: MONGO_URL=mongodb://bires_admin:PASSWORD@mongo:27017/bires?authSource=admin
# Then recreate containers:
docker compose -f docker-compose.yml -f docker-compose.prod.yml down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate
```

## Verification Steps

After applying the fix:

1. **Check backend logs**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend | tail -50
   ```
   Should see "Application startup complete" or similar success message

2. **Check backend health**
   ```bash
   curl -s http://localhost:8000/api/health
   ```
   Should return: `{"status":"healthy"}`

3. **Test MongoDB connection from backend**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend python3 -c "
   import os
   print('MONGO_URL:', os.environ.get('MONGO_URL', 'NOT SET'))
   "
   ```
   Should show the full connection string with credentials

4. **Test MongoDB authentication manually**
   ```bash
   # Get admin password from .env
   source .env
   
   # Test connection
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec mongo mongosh -u admin -p ${MONGO_ADMIN_PASSWORD} --authenticationDatabase admin --eval "db.adminCommand('ping')"
   ```
   Should return: `{ ok: 1 }`

## Common Issues After Fix

### Issue: Backend still not starting

**Check 1: Environment variables in container**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend env | grep MONGO
```

**Check 2: Network connectivity**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend ping mongo -c 3
```

**Check 3: MongoDB is accepting connections**
```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml exec mongo mongosh -u admin -p ${MONGO_ADMIN_PASSWORD} --authenticationDatabase admin
```

### Issue: "Container not running" error

If you see errors about containers not running when trying to exec commands:

```bash
# Check container status
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps

# If backend is restarting:
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs backend

# If MongoDB is not running:
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d mongo
```

## Rollback Plan

If the fix causes issues, rollback:

```bash
# On the server
cd /home/bires/bires

# Stop containers
docker compose -f docker-compose.yml -f docker-compose.prod.yml down

# Revert to previous code version
git log --oneline  # Find the commit before the fix
git reset --hard <previous-commit-hash>

# Restart with old code
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

## Contact

If you encounter issues after applying the fix:

1. Capture the error logs:
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml logs > /tmp/logs.txt
   ```

2. Check environment variables (redacted):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml exec backend env | grep -E "MONGO|REDIS" | sed 's/\(PASSWORD\|SECRET\)=.*/\1=***REDACTED***/'
   ```

3. Share the information for debugging
