#!/bin/bash
# =============================================================================
# B-IRES Platform - Production Rebuild & Restart Script
# =============================================================================
# Stops all services, rebuilds all images, and starts in production mode.
# Use this when you've made code changes that need to be deployed.
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${CYAN}============================================${NC}"
echo -e "${CYAN}  B-IRES Platform - Production Rebuild     ${NC}"
echo -e "${CYAN}============================================${NC}"
echo ""

cd "$PROJECT_DIR"

# Determine if we need sudo for docker commands
DOCKER_CMD="docker"
if ! docker info &>/dev/null 2>&1; then
    if sudo docker info &>/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
        echo -e "${YELLOW}Using sudo for docker commands${NC}"
    else
        echo -e "${RED}Cannot connect to Docker. Please ensure Docker is running and you have permission to access it.${NC}"
        exit 1
    fi
fi

# Check for .env file
if [[ ! -f ".env" ]]; then
    echo -e "${RED}Error: .env file not found. Please create one from env.example${NC}"
    exit 1
fi

# Step 1: Stop and remove all containers
echo -e "${RED}Step 1/4: Stopping and removing all production containers...${NC}"
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml down --remove-orphans 2>/dev/null || true
echo -e "${GREEN}✓ All containers stopped and removed${NC}"
echo ""

# Step 2: Remove old images for our services (not base images like mongo, redis, nginx)
echo -e "${YELLOW}Step 2/4: Removing old application images...${NC}"
# Get project name from directory
PROJECT_NAME=$(basename "$PROJECT_DIR" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]//g')

# Remove images built by this project
${DOCKER_CMD} images --filter "reference=*${PROJECT_NAME}*backend*" -q | xargs -r ${DOCKER_CMD} rmi -f 2>/dev/null || true
${DOCKER_CMD} images --filter "reference=*${PROJECT_NAME}*experiment*" -q | xargs -r ${DOCKER_CMD} rmi -f 2>/dev/null || true
${DOCKER_CMD} images --filter "reference=*${PROJECT_NAME}*admin*" -q | xargs -r ${DOCKER_CMD} rmi -f 2>/dev/null || true
${DOCKER_CMD} images --filter "reference=*bires*" -q | xargs -r ${DOCKER_CMD} rmi -f 2>/dev/null || true
${DOCKER_CMD} images --filter "reference=*experiment-shell*" -q | xargs -r ${DOCKER_CMD} rmi -f 2>/dev/null || true
${DOCKER_CMD} images --filter "reference=*admin-dashboard*" -q | xargs -r ${DOCKER_CMD} rmi -f 2>/dev/null || true

echo -e "${GREEN}✓ Old application images removed${NC}"
echo ""

# Step 3: Rebuild all images
echo -e "${YELLOW}Step 3/4: Rebuilding all production images...${NC}"
echo ""

echo -e "${CYAN}Building backend...${NC}"
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache backend
echo -e "${GREEN}✓ Backend built${NC}"
echo ""

echo -e "${CYAN}Building experiment-shell...${NC}"
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache experiment-shell
echo -e "${GREEN}✓ Experiment shell built${NC}"
echo ""

echo -e "${CYAN}Building admin-dashboard...${NC}"
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml build --no-cache admin-dashboard
echo -e "${GREEN}✓ Admin dashboard built${NC}"
echo ""

echo -e "${GREEN}✓ All images rebuilt${NC}"
echo ""

# Step 4: Start all services in production mode
echo -e "${YELLOW}Step 4/4: Starting all production services...${NC}"
echo ""

${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml up -d

echo ""
echo -e "${GREEN}============================================${NC}"
echo -e "${GREEN}  Production rebuild complete!             ${NC}"
echo -e "${GREEN}============================================${NC}"
echo ""

# Show running containers
echo -e "${BLUE}Running containers:${NC}"
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml ps

echo ""
echo -e "${CYAN}View logs with:${NC}"
echo -e "  ${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
echo ""
