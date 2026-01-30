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

echo -e "${YELLOW}========================================${NC}"
echo -e "${YELLOW}  BIRES Platform - Restart All Services${NC}"
echo -e "${YELLOW}========================================${NC}"
echo ""

cd "$PROJECT_DIR"

echo -e "${YELLOW}Stopping all services...${NC}"
docker compose -f docker-compose.yml -f docker-compose.dev.yml down

echo ""
echo -e "${YELLOW}Starting all services...${NC}"

# Use start-all.sh to handle port checking
"$SCRIPT_DIR/start-all.sh"



