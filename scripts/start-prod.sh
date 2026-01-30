#!/bin/bash
# =============================================================================
# B-IRES Platform - Production Start Script
# =============================================================================
# Starts all B-IRES services in production mode.
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

# Change to project directory
cd "${PROJECT_DIR}"

# Check for .env file
if [[ ! -f ".env" ]]; then
    log_error ".env file not found. Please run the installer or create .env manually."
    exit 1
fi

# Determine SSL mode
SSL_ENABLED="true"
if [[ -f "/var/lib/bires/.install-state" ]]; then
    SSL_ENABLED=$(grep -o '"ssl_enabled":"[^"]*"' /var/lib/bires/.install-state 2>/dev/null | cut -d'"' -f4 || echo "true")
fi

# Check for SSL certificates if SSL is enabled
if [[ "${SSL_ENABLED}" == "true" ]]; then
    DOMAIN=$(grep "^DOMAIN=" .env 2>/dev/null | cut -d= -f2 || echo "")
    if [[ -n "${DOMAIN}" && ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
        log_warning "SSL certificates not found for ${DOMAIN}"
        log_warning "Falling back to test mode (HTTP only)"
        SSL_ENABLED="false"
    fi
fi

# Set compose files
if [[ "${SSL_ENABLED}" == "true" ]]; then
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
    log_info "Starting in PRODUCTION mode (HTTPS)"
else
    COMPOSE_FILES="-f docker-compose.yml -f docker-compose.test.yml"
    log_info "Starting in TEST mode (HTTP only)"
fi

# Start infrastructure services first
log_info "Starting infrastructure services..."
docker compose ${COMPOSE_FILES} up -d mongo redis minio minio-init

# Wait for MongoDB to be ready
log_info "Waiting for MongoDB..."
for i in {1..30}; do
    if docker compose ${COMPOSE_FILES} exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; then
        log_success "MongoDB is ready"
        break
    fi
    sleep 2
done

# Wait for Redis to be ready
log_info "Waiting for Redis..."
for i in {1..15}; do
    if docker compose ${COMPOSE_FILES} exec -T redis redis-cli ping &>/dev/null; then
        log_success "Redis is ready"
        break
    fi
    sleep 2
done

# Start application services
log_info "Starting application services..."
docker compose ${COMPOSE_FILES} up -d backend experiment-shell admin-dashboard

# Wait for backend to be ready
log_info "Waiting for backend..."
for i in {1..60}; do
    if curl -s http://localhost:8000/health &>/dev/null; then
        log_success "Backend is ready"
        break
    fi
    sleep 3
done

# Start nginx
log_info "Starting nginx..."
docker compose ${COMPOSE_FILES} up -d nginx

# Wait for nginx
sleep 3

# Show status
echo ""
log_info "Service Status:"
docker compose ${COMPOSE_FILES} ps

# Get domain
DOMAIN=$(grep "^API_URL=" .env 2>/dev/null | sed 's|.*://||' | sed 's|/.*||' || echo "localhost")

echo ""
log_success "B-IRES is now running!"
echo ""

if [[ "${SSL_ENABLED}" == "true" ]]; then
    echo "  Main App:     https://${DOMAIN}"
    echo "  Admin Panel:  https://${DOMAIN}/admin"
    echo "  API:          https://${DOMAIN}/api"
else
    IP_ADDR=$(curl -s ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')
    echo "  Main App:     http://${IP_ADDR}"
    echo "  Admin Panel:  http://${IP_ADDR}/admin"
    echo "  API:          http://${IP_ADDR}/api"
fi

echo ""
echo "View logs: docker compose ${COMPOSE_FILES} logs -f"
