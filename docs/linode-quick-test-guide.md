# B-IRES Quick Test Deployment (Linode)

**⚠️ FOR TESTING ONLY - NOT FOR PRODUCTION**

This is a minimal guide to quickly test the B-IRES platform on a temporary Linode instance. No security hardening - destroy the instance after testing.

---

## 1. Create Linode Instance

1. Go to [Linode Cloud Manager](https://cloud.linode.com)
2. Click **"Create Linode"**
3. Configure:
   - **Distribution**: Ubuntu 22.04 LTS
   - **Region**: Any (closest to you)
   - **Plan**: Linode 4GB ($24/month, billed hourly)
   - **Root Password**: Set any password
4. Click **"Create Linode"**
5. Note the **IPv4 Address**

---

## 2. Connect & Install Docker

SSH into your server:

```bash
ssh root@213.168.249.143
```

Run this single block to install Docker:

```bash
apt update && apt install -y ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Verify:

```bash
docker --version
docker compose version
```

---

## 3. Transfer Project Files

### Option A: Git Clone (if repo available)

```bash
cd /root
git clone https://github.com/your-username/experiments_platrofm_v1.git
cd experiments_platrofm_v1
```

### Option B: rsync from Local Machine

On your **local machine**, run:

```bash
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '__pycache__' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'venv' \
  /home/oleg/Documents/Projects/LLMs/experiments_platrofm_v1/ \
  root@213.168.249.143:/root/experiments_platrofm_v1/
```

---

## 4. Configure Environment

```bash
cd /root/experiments_platrofm_v1
cp env.example .env
nano .env
```

Update these values:

```bash
# Minimal changes for testing
ENVIRONMENT=production
DEBUG=false
API_URL=http://213.168.249.143
FRONTEND_URL=http://213.168.249.143
ADMIN_URL=http://213.168.249.143/admin

# Keep default passwords for testing (change JWT_SECRET)
JWT_SECRET=test_secret_key_for_temporary_instance_only
```

Save and exit (`Ctrl+X`, `Y`, `Enter`).

---

## 5. Configure Nginx for HTTP Only

Create a simple HTTP-only nginx config:

```bash
cat > nginx/nginx.test.conf << 'EOF'
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent"';

    access_log /var/log/nginx/access.log main;

    sendfile on;
    keepalive_timeout 65;
    client_max_body_size 100M;

    gzip on;
    gzip_types text/plain text/css application/json application/javascript;

    upstream backend {
        server backend:8000;
    }

    upstream experiment_shell {
        server experiment-shell:3000;
    }

    upstream admin_dashboard {
        server admin-dashboard:3001;
    }

    server {
        listen 80;
        server_name _;

        # API
        location /api/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Connection "";
        }

        # WebSocket for external tasks
        location /api/ws/ {
            proxy_pass http://backend;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }

        # Admin Dashboard
        location /admin {
            proxy_pass http://admin_dashboard;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }

        # Experiment Shell (default)
        location / {
            proxy_pass http://experiment_shell;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\n";
            add_header Content-Type text/plain;
        }
    }
}
EOF
```

---

## 6. Create Test Docker Compose Override

```bash
cat > docker-compose.test.yml << 'EOF'
version: "3.9"

# Test overrides - HTTP only, no SSL
services:
  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    command: gunicorn app.main:app --workers 2 --worker-class uvicorn.workers.UvicornWorker --bind 0.0.0.0:8000
    environment:
      - ENVIRONMENT=production
      - DEBUG=false
    restart: always

  experiment-shell:
    build:
      context: ./frontend/experiment-shell
      dockerfile: Dockerfile
    restart: always

  admin-dashboard:
    build:
      context: ./frontend/admin-dashboard
      dockerfile: Dockerfile
    restart: always

  mongo:
    restart: always

  redis:
    restart: always

  minio:
    restart: always

  nginx:
    volumes:
      - ./nginx/nginx.test.conf:/etc/nginx/nginx.conf:ro
    restart: always
EOF
```

---

## 7. Build and Start

```bash
cd /root/experiments_platrofm_v1

# Build and start all services (this takes 3-5 minutes on first run)
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
```

Watch the build progress:

```bash
docker compose logs -f
```

Press `Ctrl+C` to exit logs when you see services are running.

---

## 8. Verify Deployment

Check all containers are running:

```bash
docker compose ps
```

All should show "Up" status.

Test access:

```bash
# Test API
curl http://localhost/api/health

# Or from your browser:
# Experiment Shell: http://213.168.249.143/
# Admin Dashboard:  http://213.168.249.143/admin
# API Docs:         http://213.168.249.143/api/docs
```

---

## 9. Login to Admin Dashboard

1. Open browser: `http://213.168.249.143/admin`
2. Login with default credentials:
   - **Email**: `admin@example.com`
   - **Password**: `admin123`

---

## 10. Quick Commands Reference

```bash
# View all logs
docker compose logs -f

# View specific service logs
docker compose logs -f backend
docker compose logs -f nginx

# Restart all services
docker compose restart

# Restart specific service
docker compose restart backend

# Stop everything
docker compose down

# Rebuild and restart (after code changes)
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build

# Check container status
docker compose ps

# Enter backend container
docker compose exec backend bash

# Enter MongoDB shell
docker compose exec mongo mongosh bires

# Check disk usage
docker system df
```

---

## 11. Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs backend

# Check if ports are in use
netstat -tlnp | grep -E '80|443|8000|3000|3001'
```

### 502 Bad Gateway

```bash
# Backend might still be starting, wait 30 seconds and retry
# Or check backend logs:
docker compose logs backend
```

### Can't connect to site

```bash
# Make sure nginx is running
docker compose ps nginx

# Check nginx config syntax
docker compose exec nginx nginx -t
```

### Out of memory

```bash
# Check memory usage
free -h
docker stats --no-stream

# Restart with fresh containers
docker compose down
docker system prune -f
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build
```

---

## 12. Cleanup (When Done Testing)

### Stop and remove containers

```bash
docker compose down -v  # -v removes volumes (database data)
```

### Delete the Linode Instance

1. Go to [Linode Cloud Manager](https://cloud.linode.com)
2. Select your Linode
3. Click **"Delete"** in the settings

**Remember**: You're billed hourly, so delete when done!

---

## Quick Start Summary (Copy-Paste)

```bash
# 1. Install Docker (run on fresh Linode)
apt update && apt install -y ca-certificates curl gnupg
mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
apt update && apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# 2. Transfer files (run from LOCAL machine)
# rsync -avz --progress --exclude 'node_modules' --exclude '__pycache__' --exclude '.git' --exclude '.env' /path/to/experiments_platrofm_v1/ root@YOUR_IP:/root/experiments_platrofm_v1/

# 3. Setup (run on Linode after transfer)
cd /root/experiments_platrofm_v1
cp env.example .env
# Edit .env: nano .env (update JWT_SECRET and URLs with your IP)

# 4. Create nginx test config (see Section 5)
# 5. Create docker-compose.test.yml (see Section 6)

# 6. Start
docker compose -f docker-compose.yml -f docker-compose.test.yml up -d --build

# 7. Access
# http://YOUR_IP/ - Experiment Shell
# http://YOUR_IP/admin - Admin Dashboard (admin@example.com / admin123)
```

---

*For temporary testing only. Destroy instance after use.*


