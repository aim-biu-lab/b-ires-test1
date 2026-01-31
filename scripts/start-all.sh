#!/bin/bash
# Start all services in development mode
# Validates ports and kills conflicting processes before starting

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
        echo -e "${YELLOW}Using sudo for docker commands (tip: log out and back in to use docker without sudo)${NC}"
    else
        echo -e "${RED}Cannot connect to Docker. Please ensure Docker is running and you have permission to access it.${NC}"
        exit 1
    fi
fi

# Required ports for all services
REQUIRED_PORTS=(
    "8000:Backend API"
    "3000:Experiment Shell"
    "3001:Admin Dashboard"
    "27017:MongoDB"
    "6379:Redis"
    "9000:MinIO API"
    "9001:MinIO Console"
    "8081:Mongo Express"
)

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  BIRES Platform - Start All Services  ${NC}"
echo -e "${GREEN}========================================${NC}"

# Function to check and kill process on a port
checkAndKillPort() {
    local port=$1
    local serviceName=$2
    
    # Check if port is in use
    local pid=$(lsof -ti :$port 2>/dev/null || true)
    
    if [ -n "$pid" ]; then
        echo -e "${YELLOW}⚠ Port $port ($serviceName) is in use by PID: $pid${NC}"
        echo -e "${YELLOW}  Killing process...${NC}"
        kill -9 $pid 2>/dev/null || true
        sleep 1
        
        # Verify it's killed
        pid=$(lsof -ti :$port 2>/dev/null || true)
        if [ -n "$pid" ]; then
            echo -e "${RED}✗ Failed to kill process on port $port${NC}"
            exit 1
        fi
        echo -e "${GREEN}✓ Port $port is now free${NC}"
    else
        echo -e "${GREEN}✓ Port $port ($serviceName) is available${NC}"
    fi
}

echo ""
echo -e "${YELLOW}Checking required ports...${NC}"
echo ""

for portInfo in "${REQUIRED_PORTS[@]}"; do
    port="${portInfo%%:*}"
    serviceName="${portInfo##*:}"
    checkAndKillPort "$port" "$serviceName"
done

echo ""
echo -e "${GREEN}All ports are available!${NC}"
echo ""

cd "$PROJECT_DIR"

echo -e "${YELLOW}Starting services with docker compose...${NC}"
echo ""

# Start all services except nginx (disabled in dev mode)
${DOCKER_CMD} compose -f docker-compose.yml -f docker-compose.dev.yml up -d --scale nginx=0

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  All services started successfully!   ${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "Services available at:"
echo "  • Backend API:       http://localhost:8000"
echo "  • Experiment Shell:  http://localhost:3000"
echo "  • Admin Dashboard:   http://localhost:3001"
echo "  • Mongo Express:     http://localhost:8081"
echo "  • MinIO Console:     http://localhost:9001"
echo ""



