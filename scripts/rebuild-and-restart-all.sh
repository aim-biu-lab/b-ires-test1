#!/bin/bash
# Kill everything, rebuild all components, and start again

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}  BIRES Platform - Rebuild & Restart   ${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""

cd "$PROJECT_DIR"

# Step 1: Stop and remove all containers
echo -e "${RED}Step 1/4: Stopping and removing all containers...${NC}"
docker compose -f docker-compose.yml -f docker-compose.dev.yml down --remove-orphans
echo -e "${GREEN}✓ All containers stopped and removed${NC}"
echo ""

# Step 2: Remove old images for our services (not base images like mongo, redis, etc.)
echo -e "${YELLOW}Step 2/4: Removing old images...${NC}"
# Get project name from directory
PROJECT_NAME=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')

# Remove images built by this project
docker images --filter "reference=*${PROJECT_NAME}*" -q | xargs -r docker rmi -f 2>/dev/null || true
docker images --filter "reference=*bires*" -q | xargs -r docker rmi -f 2>/dev/null || true
docker images --filter "reference=*experiment*" -q | xargs -r docker rmi -f 2>/dev/null || true
docker images --filter "reference=*admin-dashboard*" -q | xargs -r docker rmi -f 2>/dev/null || true
docker images --filter "reference=*backend*" -q | xargs -r docker rmi -f 2>/dev/null || true

echo -e "${GREEN}✓ Old images removed${NC}"
echo ""

# Step 3: Rebuild all images
echo -e "${YELLOW}Step 3/4: Rebuilding all images...${NC}"
echo ""

echo -e "${CYAN}Building backend...${NC}"
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache backend

echo ""
echo -e "${CYAN}Building experiment-shell...${NC}"
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache experiment-shell

echo ""
echo -e "${CYAN}Building admin-dashboard...${NC}"
docker compose -f docker-compose.yml -f docker-compose.dev.yml build --no-cache admin-dashboard

echo -e "${GREEN}✓ All images rebuilt${NC}"
echo ""

# Step 4: Start all services using start-all.sh (handles port checking)
echo -e "${YELLOW}Step 4/4: Starting all services...${NC}"
echo ""
"$SCRIPT_DIR/start-all.sh"



