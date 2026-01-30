#!/bin/bash
# Helper script to run docker-compose in development mode
# Automatically excludes nginx to avoid port 80 conflicts

# Check if first argument is a docker-compose command
if [ "$1" = "up" ] || [ "$1" = "start" ]; then
    # For commands that start services, add --scale nginx=0
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml "$@" --scale nginx=0
else
    # For other commands (restart, stop, down, etc.), run normally
    # Note: restart doesn't need --scale since it only restarts specified services
    docker-compose -f docker-compose.yml -f docker-compose.dev.yml "$@"
fi
