#!/bin/bash
# Initialize local MongoDB with project schema
# Run this after installing MongoDB locally

set -e

echo "Initializing local MongoDB database..."

# Run the initialization script
mongosh < docker/mongo/init/01-init.js

echo ""
echo "Database initialization complete!"
echo "You can now connect to MongoDB using: mongosh"



