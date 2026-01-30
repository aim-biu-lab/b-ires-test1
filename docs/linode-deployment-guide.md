# B-IRES Platform Deployment Guide for Linode VPS

This guide provides step-by-step instructions for deploying the B-IRES (Bar-Ilan Research Evaluation System) platform to a Linode VPS.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Create and Configure Linode VPS](#2-create-and-configure-linode-vps)
3. [Initial Server Setup](#3-initial-server-setup)
4. [Install Docker and Docker Compose](#4-install-docker-and-docker-compose)
5. [Configure Domain and DNS](#5-configure-domain-and-dns)
6. [Transfer Project Files](#6-transfer-project-files)
7. [Configure Environment Variables](#7-configure-environment-variables)
8. [Configure SSL Certificates](#8-configure-ssl-certificates)
9. [Update Nginx Configuration](#9-update-nginx-configuration)
10. [Deploy the Application](#10-deploy-the-application)
11. [Post-Deployment Tasks](#11-post-deployment-tasks)
12. [Maintenance and Monitoring](#12-maintenance-and-monitoring)
13. [Troubleshooting](#13-troubleshooting)
14. [Backup Strategy](#14-backup-strategy)

---

## 1. Prerequisites

Before you begin, ensure you have:

- A Linode account (https://cloud.linode.com)
- A domain name (e.g., `yourdomain.com`)
- Access to domain DNS settings
- SSH key pair for secure server access
- The project files on your local machine

### Recommended Linode Plan

| Component | Requirement |
|-----------|-------------|
| **Plan** | Linode 4GB (Shared CPU) or higher |
| **vCPUs** | 2+ cores |
| **RAM** | 4GB minimum (8GB recommended) |
| **Storage** | 80GB+ SSD |
| **Transfer** | 4TB/month |

For production with expected high traffic, consider **Linode 8GB** or **Dedicated CPU** plans.

---

## 2. Create and Configure Linode VPS

### 2.1 Create the Linode Instance

1. Log in to [Linode Cloud Manager](https://cloud.linode.com)
2. Click **"Create Linode"**
3. Configure the instance:
   - **Distribution**: Ubuntu 22.04 LTS (recommended)
   - **Region**: Choose closest to your target users
   - **Plan**: Linode 4GB or higher
   - **Linode Label**: `bires-production`
   - **Root Password**: Set a strong password
   - **SSH Keys**: Add your public SSH key

4. Click **"Create Linode"** and wait for provisioning

### 2.2 Note Your IP Addresses

Once created, note down:
- **IPv4 Address**: `xxx.xxx.xxx.xxx`
- **IPv6 Address**: `xxxx:xxxx:xxxx::xxxx` (optional)

---

## 3. Initial Server Setup

### 3.1 Connect to Your Server

```bash
ssh root@YOUR_LINODE_IP
```

### 3.2 Update System Packages

```bash
apt update && apt upgrade -y
```

### 3.3 Create a Non-Root User

```bash
# Create user
adduser bires

# Add to sudo group
usermod -aG sudo bires

# Copy SSH keys to new user
mkdir -p /home/bires/.ssh
cp ~/.ssh/authorized_keys /home/bires/.ssh/
chown -R bires:bires /home/bires/.ssh
chmod 700 /home/bires/.ssh
chmod 600 /home/bires/.ssh/authorized_keys
```

### 3.4 Configure SSH Security

Edit SSH configuration:

```bash
nano /etc/ssh/sshd_config
```

Update these settings:

```
PermitRootLogin no
PasswordAuthentication no
PubkeyAuthentication yes
```

Restart SSH:

```bash
systemctl restart sshd
```

**Important**: Open a new terminal and verify you can log in as the new user before closing your root session:

```bash
ssh bires@YOUR_LINODE_IP
```

### 3.5 Configure Firewall (UFW)

```bash
# Enable UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing

# Allow SSH
sudo ufw allow OpenSSH

# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Enable firewall
sudo ufw enable

# Verify status
sudo ufw status
```

### 3.6 Set Timezone

```bash
sudo timedatectl set-timezone UTC
```

### 3.7 Install Essential Packages

```bash
sudo apt install -y \
    git \
    curl \
    wget \
    htop \
    nano \
    unzip \
    fail2ban
```

---

## 4. Install Docker and Docker Compose

### 4.1 Install Docker

```bash
# Remove old versions
sudo apt remove docker docker-engine docker.io containerd runc

# Install prerequisites
sudo apt install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

### 4.2 Add User to Docker Group

```bash
sudo usermod -aG docker bires

# Apply group changes (log out and back in, or run):
newgrp docker
```

### 4.3 Verify Installation

```bash
docker --version
docker compose version
```

### 4.4 Configure Docker for Production

Create Docker daemon configuration:

```bash
sudo nano /etc/docker/daemon.json
```

Add:

```json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "storage-driver": "overlay2"
}
```

Restart Docker:

```bash
sudo systemctl restart docker
```

---

## 5. Configure Domain and DNS

### 5.1 DNS Records to Create

Go to your domain registrar or DNS provider and create these records:

| Type | Name | Value | TTL |
|------|------|-------|-----|
| A | @ | YOUR_LINODE_IP | 300 |
| A | www | YOUR_LINODE_IP | 300 |
| A | api | YOUR_LINODE_IP | 300 |
| A | admin | YOUR_LINODE_IP | 300 |

**Example for `bires-study.com`:**

```
bires-study.com          -> YOUR_LINODE_IP
www.bires-study.com      -> YOUR_LINODE_IP
api.bires-study.com      -> YOUR_LINODE_IP
admin.bires-study.com    -> YOUR_LINODE_IP
```

### 5.2 Verify DNS Propagation

Wait for DNS propagation (can take up to 48 hours, usually faster):

```bash
# From your local machine
dig yourdomain.com +short
nslookup yourdomain.com
```

---

## 6. Transfer Project Files

### 6.1 Option A: Using Git (Recommended)

If your project is in a Git repository:

```bash
# On the server, as bires user
cd ~
git clone https://github.com/your-username/experiments_platrofm_v1.git
cd experiments_platrofm_v1
```

### 6.2 Option B: Using rsync

From your local machine:

```bash
# Sync entire project (excluding node_modules, venv, etc.)
rsync -avz --progress \
  --exclude 'node_modules' \
  --exclude '__pycache__' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'venv' \
  --exclude '*.pyc' \
  --exclude 'mongo_data' \
  --exclude 'redis_data' \
  --exclude 'minio_data' \
  /path/to/experiments_platrofm_v1/ \
  bires@YOUR_LINODE_IP:~/experiments_platrofm_v1/
```

### 6.3 Option C: Using scp

For smaller transfers:

```bash
# Create tarball locally (excluding large directories)
cd /path/to/experiments_platrofm_v1
tar --exclude='node_modules' --exclude='__pycache__' --exclude='.git' \
    -czvf ../bires-project.tar.gz .

# Transfer to server
scp ../bires-project.tar.gz bires@YOUR_LINODE_IP:~/

# On server, extract
ssh bires@YOUR_LINODE_IP
mkdir -p ~/experiments_platrofm_v1
cd ~/experiments_platrofm_v1
tar -xzvf ~/bires-project.tar.gz
rm ~/bires-project.tar.gz
```

### 6.4 Set Proper Permissions

```bash
cd ~/experiments_platrofm_v1
chmod +x scripts/*.sh
chmod 755 -R nginx/
```

---

## 7. Configure Environment Variables

### 7.1 Create Production .env File

```bash
cd ~/experiments_platrofm_v1
cp env.example .env
nano .env
```

### 7.2 Update .env for Production

Replace with production values:

```bash
# ======================
# Security (REQUIRED - CHANGE THESE!)
# ======================
JWT_SECRET=GENERATE_A_SECURE_64_CHARACTER_RANDOM_STRING_HERE
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# ======================
# MongoDB
# ======================
MONGO_URL=mongodb://mongo:27017
MONGO_DB=bires
MONGO_USER=bires_admin
MONGO_PASSWORD=GENERATE_SECURE_PASSWORD_1

# ======================
# Redis
# ======================
REDIS_URL=redis://:GENERATE_SECURE_PASSWORD_2@redis:6379
REDIS_PASSWORD=GENERATE_SECURE_PASSWORD_2

# ======================
# MinIO / S3
# ======================
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=bires_minio_admin
MINIO_SECRET_KEY=GENERATE_SECURE_PASSWORD_3
MINIO_BUCKET=bires-assets
MINIO_SECURE=false

# ======================
# Application
# ======================
ENVIRONMENT=production
DEBUG=false
API_URL=https://yourdomain.com/api
FRONTEND_URL=https://yourdomain.com
ADMIN_URL=https://yourdomain.com/admin
```

### 7.3 Generate Secure Passwords

Use this command to generate secure random strings:

```bash
# Generate JWT secret (64 characters)
openssl rand -hex 32

# Generate passwords (32 characters each)
openssl rand -hex 16
```

**Important**: Keep these passwords secure and never commit them to version control!

---

## 8. Configure SSL Certificates

### 8.1 Install Certbot

```bash
sudo apt install -y certbot
```

### 8.2 Stop Any Running Services on Port 80

```bash
sudo systemctl stop nginx 2>/dev/null || true
docker compose down 2>/dev/null || true
```

### 8.3 Obtain SSL Certificate

```bash
sudo certbot certonly --standalone \
  -d yourdomain.com \
  -d www.yourdomain.com \
  --email your-email@example.com \
  --agree-tos \
  --non-interactive
```

For multiple subdomains:

```bash
sudo certbot certonly --standalone \
  -d yourdomain.com \
  -d www.yourdomain.com \
  -d api.yourdomain.com \
  -d admin.yourdomain.com \
  --email your-email@example.com \
  --agree-tos \
  --non-interactive
```

### 8.4 Verify Certificate Location

Certificates will be at:
- `/etc/letsencrypt/live/yourdomain.com/fullchain.pem`
- `/etc/letsencrypt/live/yourdomain.com/privkey.pem`

### 8.5 Set Up Auto-Renewal

```bash
# Test renewal
sudo certbot renew --dry-run

# Certbot installs a systemd timer automatically
# Verify it's active:
sudo systemctl status certbot.timer
```

### 8.6 Create Renewal Hook Script

```bash
sudo nano /etc/letsencrypt/renewal-hooks/post/restart-nginx.sh
```

Add:

```bash
#!/bin/bash
cd /home/bires/experiments_platrofm_v1
docker compose restart nginx
```

Make executable:

```bash
sudo chmod +x /etc/letsencrypt/renewal-hooks/post/restart-nginx.sh
```

---

## 9. Update Nginx Configuration

### 9.1 Edit nginx.prod.conf

```bash
cd ~/experiments_platrofm_v1
nano nginx/nginx.prod.conf
```

### 9.2 Update SSL Certificate Paths

Replace `yourdomain.com` with your actual domain in these lines:

```nginx
ssl_certificate /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;
```

### 9.3 Update Server Names (Optional - for subdomain setup)

If using subdomains, you can configure separate server blocks. The current configuration uses a single domain with path-based routing:

- `https://yourdomain.com/` → Experiment Shell
- `https://yourdomain.com/admin` → Admin Dashboard
- `https://yourdomain.com/api/` → Backend API

---

## 10. Deploy the Application

### 10.1 Build and Start Services

```bash
cd ~/experiments_platrofm_v1

# Build and start all services
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 10.2 Verify All Containers Are Running

```bash
docker compose ps
```

Expected output:

```
NAME                    STATUS          PORTS
bires-admin-dashboard   Up              3001/tcp
bires-backend           Up              8000/tcp
bires-experiment-shell  Up              3000/tcp
bires-minio             Up              9000-9001/tcp
bires-mongo             Up              27017/tcp
bires-nginx             Up              0.0.0.0:80->80/tcp, 0.0.0.0:443->443/tcp
bires-redis             Up              6379/tcp
```

### 10.3 Check Service Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f nginx
```

### 10.4 Verify Application is Accessible

```bash
# Test HTTPS
curl -I https://yourdomain.com

# Test API health
curl https://yourdomain.com/api/health

# Test admin dashboard
curl -I https://yourdomain.com/admin
```

---

## 11. Post-Deployment Tasks

### 11.1 Change Default Admin Password

1. Navigate to `https://yourdomain.com/admin`
2. Log in with default credentials:
   - Email: `admin@example.com`
   - Password: `admin123`
3. **Immediately change the password** in user settings

### 11.2 Create Additional Admin Users

```bash
# Connect to MongoDB container
docker compose exec mongo mongosh bires

# In MongoDB shell, create new admin
db.users.insertOne({
  _id: "admin-" + new Date().getTime(),
  email: "your-email@example.com",
  username: "yourusername",
  full_name: "Your Name",
  role: "admin",
  is_active: true,
  hashed_password: "USE_PASSWORD_HASH_HERE",
  created_at: new Date(),
  updated_at: new Date()
})
```

Or use the admin dashboard to create new users.

### 11.3 Disable Default Admin (Optional)

After creating your own admin account:

```bash
docker compose exec mongo mongosh bires
db.users.updateOne(
  { email: "admin@example.com" },
  { $set: { is_active: false } }
)
```

### 11.4 Test All Functionality

- [ ] Login to admin dashboard
- [ ] Create a test experiment
- [ ] Upload test assets
- [ ] Test experiment shell (participant view)
- [ ] Complete a test session
- [ ] Export test data
- [ ] Test API endpoints

---

## 12. Maintenance and Monitoring

### 12.1 View Logs

```bash
# All logs
docker compose logs -f

# Last 100 lines of backend
docker compose logs --tail 100 backend

# Follow nginx access logs
docker compose logs -f nginx
```

### 12.2 Restart Services

```bash
# Restart all
docker compose restart

# Restart specific service
docker compose restart backend

# Full rebuild and restart
docker compose down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 12.3 Update Application

```bash
cd ~/experiments_platrofm_v1

# Pull latest changes (if using git)
git pull origin main

# Rebuild and restart
docker compose down
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

### 12.4 Monitor System Resources

```bash
# Docker stats
docker stats

# System resources
htop

# Disk usage
df -h

# Docker disk usage
docker system df
```

### 12.5 Clean Up Docker Resources

```bash
# Remove unused images
docker image prune -a

# Remove unused volumes (CAREFUL - this removes data volumes too!)
docker volume prune

# Full cleanup
docker system prune -a
```

### 12.6 Set Up Monitoring (Optional)

Consider adding monitoring tools:

```bash
# Install Netdata for real-time monitoring
bash <(curl -Ss https://my-netdata.io/kickstart.sh)

# Access at http://YOUR_LINODE_IP:19999
```

---

## 13. Troubleshooting

### 13.1 Container Not Starting

```bash
# Check logs
docker compose logs container_name

# Check configuration
docker compose config

# Verify .env file is loaded
docker compose config | grep -i jwt
```

### 13.2 SSL Certificate Issues

```bash
# Verify certificate exists
sudo ls -la /etc/letsencrypt/live/yourdomain.com/

# Check certificate expiry
sudo certbot certificates

# Force renewal
sudo certbot renew --force-renewal
```

### 13.3 Database Connection Issues

```bash
# Check if MongoDB is running
docker compose logs mongo

# Connect to MongoDB manually
docker compose exec mongo mongosh

# Check database
use bires
db.users.find()
```

### 13.4 Nginx 502 Bad Gateway

```bash
# Check if backend is running
docker compose logs backend

# Check nginx configuration
docker compose exec nginx nginx -t

# Restart services
docker compose restart backend nginx
```

### 13.5 Permission Issues

```bash
# Fix ownership
sudo chown -R bires:bires ~/experiments_platrofm_v1

# Fix Docker socket permissions
sudo chmod 666 /var/run/docker.sock
```

### 13.6 Out of Disk Space

```bash
# Check disk usage
df -h

# Find large files
du -sh /* 2>/dev/null | sort -rh | head -10

# Clean Docker
docker system prune -a --volumes
```

---

## 14. Backup Strategy

### 14.1 Database Backup Script

Create backup script:

```bash
nano ~/backup-bires.sh
```

```bash
#!/bin/bash

# Configuration
BACKUP_DIR="/home/bires/backups"
DATE=$(date +%Y-%m-%d_%H-%M-%S)
RETENTION_DAYS=7

# Create backup directory
mkdir -p $BACKUP_DIR

# Backup MongoDB
echo "Backing up MongoDB..."
docker compose exec -T mongo mongodump --archive --gzip > $BACKUP_DIR/mongodb_$DATE.gz

# Backup MinIO data
echo "Backing up MinIO..."
docker compose exec -T minio tar czf - /data > $BACKUP_DIR/minio_$DATE.tar.gz

# Backup configuration
echo "Backing up configuration..."
cp ~/experiments_platrofm_v1/.env $BACKUP_DIR/env_$DATE.backup
tar czf $BACKUP_DIR/config_$DATE.tar.gz \
  ~/experiments_platrofm_v1/nginx/ \
  ~/experiments_platrofm_v1/experiments/ \
  ~/experiments_platrofm_v1/themes/

# Remove old backups
find $BACKUP_DIR -type f -mtime +$RETENTION_DAYS -delete

echo "Backup completed: $DATE"
ls -lh $BACKUP_DIR/
```

Make executable and schedule:

```bash
chmod +x ~/backup-bires.sh

# Add to crontab (daily at 3 AM)
crontab -e
```

Add line:

```
0 3 * * * /home/bires/backup-bires.sh >> /home/bires/backup.log 2>&1
```

### 14.2 Restore from Backup

```bash
# Restore MongoDB
docker compose exec -T mongo mongorestore --archive --gzip < /path/to/backup/mongodb_DATE.gz

# Restore MinIO
docker compose exec -T minio tar xzf - < /path/to/backup/minio_DATE.tar.gz
```

### 14.3 Off-Site Backup (Linode Object Storage)

Consider using Linode Object Storage for off-site backups:

```bash
# Install s3cmd
sudo apt install s3cmd

# Configure with Linode Object Storage credentials
s3cmd --configure

# Upload backups
s3cmd put /home/bires/backups/* s3://your-backup-bucket/bires/
```

---

## Quick Reference Commands

```bash
# Start all services
cd ~/experiments_platrofm_v1
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Restart a service
docker compose restart backend

# Rebuild and restart
docker compose up -d --build

# Check status
docker compose ps

# Enter container shell
docker compose exec backend bash
docker compose exec mongo mongosh bires

# Backup database
docker compose exec -T mongo mongodump --archive --gzip > backup.gz

# SSL renewal
sudo certbot renew
```

---

## Security Checklist

- [ ] Changed default admin password
- [ ] SSH key-only authentication enabled
- [ ] Root login disabled
- [ ] Firewall configured (UFW)
- [ ] Fail2ban installed and configured
- [ ] Strong passwords in .env file
- [ ] SSL/TLS configured with auto-renewal
- [ ] Regular backups scheduled
- [ ] System updates automated

---

## Support

For issues or questions:
1. Check container logs: `docker compose logs service_name`
2. Review this guide's troubleshooting section
3. Check Linode documentation: https://www.linode.com/docs/
4. Docker documentation: https://docs.docker.com/

---

*Last updated: January 2026*

