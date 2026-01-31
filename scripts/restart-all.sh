#!/bin/bash
# Restart all services

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Determine if we need sudo for docker commands
DOCKER_CMD="docker"
if ! docker info &>/dev/null 2>&1; then
    if sudo docker info &>/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
    else
        echo -e "${RED}Cannot connect to Docker. Please ensure Docker is running and you have permission to access it.${NC}"
        exit 1
    fi
fi

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  BIRES Platform - Restart All Services${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

cd "$PROJECT_DIR"

echo -e "${YELLOW}Stopping all services...${NC}"
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.dev.yml down

echo ""
echo -e "${YELLOW}Starting all services...${NC}"

# Use start-all.sh to handle port checking
"$SCRIPT_DIR/start-all.sh"



