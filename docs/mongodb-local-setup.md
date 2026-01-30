# MongoDB Local Installation Guide

This guide explains how to install and use MongoDB locally (outside of Docker) so you can access the database even when Docker containers are not running.

## Installation

### Step 1: Install MongoDB

Run the installation script:

```bash
bash scripts/install-mongodb-local.sh
```

Or install manually:

```bash
# Import MongoDB public GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu jammy/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Update and install
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start and enable MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod
```

### Step 2: Initialize Database

Run the initialization script to set up the database schema:

```bash
bash scripts/init-local-mongodb.sh
```

Or manually:

```bash
mongosh < docker/mongo/init/01-init.js
```

## Configuration

### Using Local MongoDB with the Application

The application uses the `MONGO_URL` environment variable to connect to MongoDB. By default, it connects to `localhost:27017` when running outside Docker.

**Option 1: Use .env file**

Create or update `.env` file:

```bash
MONGO_URL=mongodb://localhost:27017
MONGO_DB=bires
```

**Option 2: Environment variable**

```bash
export MONGO_URL=mongodb://localhost:27017
export MONGO_DB=bires
```

### Switching Between Docker and Local MongoDB

- **Docker MongoDB**: `MONGO_URL=mongodb://mongo:27017` (use when running in Docker)
- **Local MongoDB**: `MONGO_URL=mongodb://localhost:27017` (use when running locally)

## Accessing MongoDB

### MongoDB Shell (mongosh)

Connect to the database:

```bash
mongosh
# or
mongosh bires
```

### Useful Commands

```bash
# Check MongoDB status
sudo systemctl status mongod

# Start MongoDB
sudo systemctl start mongod

# Stop MongoDB
sudo systemctl stop mongod

# Restart MongoDB
sudo systemctl restart mongod

# View MongoDB logs
sudo journalctl -u mongod -f

# Connect to specific database
mongosh bires

# List databases
mongosh --eval "show dbs"

# List collections
mongosh bires --eval "show collections"
```

## Default Admin User

After initialization, you can log in with:

- **Email**: `admin@example.com`
- **Password**: `admin123`

**⚠️ IMPORTANT**: Change this password in production!

## Troubleshooting

### MongoDB won't start

Check logs:
```bash
sudo journalctl -u mongod -n 50
```

Check if port 27017 is in use:
```bash
sudo lsof -i :27017
```

### Permission issues

MongoDB data directory should be owned by `mongod` user:
```bash
sudo chown -R mongod:mongod /var/lib/mongodb
```

### Connection refused

Ensure MongoDB is running:
```bash
sudo systemctl status mongod
```

Check if MongoDB is listening on the correct port:
```bash
sudo netstat -tlnp | grep 27017
```

## Data Location

- **Data directory**: `/var/lib/mongodb`
- **Log file**: `/var/log/mongodb/mongod.log`
- **Config file**: `/etc/mongod.conf`

## Backup and Restore

### Backup

```bash
mongodump --db bires --out /path/to/backup
```

### Restore

```bash
mongorestore --db bires /path/to/backup/bires
```

