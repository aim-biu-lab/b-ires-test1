#!/bin/bash
# =============================================================================
# B-IRES Platform - Production Stop Script
# =============================================================================
# Stops all B-IRES services gracefully.
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Determine if we need sudo for docker commands
DOCKER_CMD="docker"
if ! docker info &>/dev/null 2>&1; then
    if sudo docker info &>/dev/null 2>&1; then
        DOCKER_CMD="sudo docker"
    else
        log_error "Cannot connect to Docker. Please ensure Docker is running and you have permission to access it."
        exit 1
    fi
fi

# Change to project directory
cd "${PROJECT_DIR}"

# Determine SSL mode
SSL_ENABLED="true"
if [[ -f "/var/lib/bires/.install-state" ]]; then
    SSL_ENABLED=$(grep -o '"ssl_enabled":"[^"]*"' /var/lib/bires/.install-state 2>/dev/null | cut -d'"' -f4 || echo "true")
fi

# Set compose files
if [[ "${SSL_ENABLED}" == "true" ]]; then
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
else
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.test.yml"
fi

log_info "Stopping B-IRES services..."

# Stop all services
${DOCKER_CMD} compose ${COMPOSE_FILES} down

log_success "All B-IRES services stopped"

# Show any remaining containers
REMAINING=$(${DOCKER_CMD} ps --filter "name=bires" --format "{{.Names}}" 2>/dev/null)
if [[ -n "${REMAINING}" ]]; then
    log_warning "Some containers may still be running:"
    echo "${REMAINING}"
fi
