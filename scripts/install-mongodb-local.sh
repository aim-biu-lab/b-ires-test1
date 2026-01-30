#!/bin/bash
# MongoDB Local Installation Script for Ubuntu
# Run with: bash scripts/install-mongodb-local.sh

set -e

echo "Installing MongoDB Community Edition 7.0..."

# Detect Ubuntu codename
UBUNTU_CODENAME=$(lsb_release -cs 2>/dev/null || echo "jammy")

# MongoDB may not have repositories for all Ubuntu versions
# Use jammy (22.04) as fallback for newer versions
if [[ "$UBUNTU_CODENAME" != "jammy" && "$UBUNTU_CODENAME" != "focal" ]]; then
    echo "Note: Using jammy repository for MongoDB (compatible with Ubuntu $UBUNTU_CODENAME)"
    UBUNTU_CODENAME="jammy"
fi

# Import MongoDB public GPG key
curl -fsSL https://www.mongodb.org/static/pgp/server-7.0.asc | sudo gpg -o /usr/share/keyrings/mongodb-server-7.0.gpg --dearmor

# Add MongoDB repository
echo "deb [ arch=amd64,arm64 signed-by=/usr/share/keyrings/mongodb-server-7.0.gpg ] https://repo.mongodb.org/apt/ubuntu ${UBUNTU_CODENAME}/mongodb-org/7.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-7.0.list

# Update package database
sudo apt-get update

# Install MongoDB
sudo apt-get install -y mongodb-org

# Start MongoDB service
sudo systemctl start mongod

# Enable MongoDB to start on boot
sudo systemctl enable mongod

# Check status
echo ""
echo "MongoDB installation complete!"
echo "Checking status..."
sudo systemctl status mongod --no-pager | head -10

echo ""
echo "MongoDB is now running locally on port 27017"
echo "You can connect using: mongosh"
echo ""
echo "To initialize the database with your project schema, run:"
echo "  mongosh < docker/mongo/init/01-init.js"

