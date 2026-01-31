#!/bin/bash
# =============================================================================
# B-IRES Backend Diagnostics Script
# =============================================================================
# This script helps diagnose backend startup issues by testing connections
# to MongoDB, Redis, and MinIO independently.
# =============================================================================

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[OK]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Determine compose files to use
if [[ -f ".env" ]]; then
    source .env
fi

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

echo "================================================================"
echo "B-IRES Backend Diagnostics"
echo "================================================================"
echo ""

# 1. Check if containers are running
log_info "Checking container status..."
echo ""
docker compose ${COMPOSE_FILES} ps
echo ""

# 2. Check MongoDB
log_info "Testing MongoDB connection..."
if docker compose ${COMPOSE_FILES} exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; then
    log_success "MongoDB is responding"
    
    # Check if we can authenticate
    if [[ -n "${MONGO_USER}" ]] && [[ -n "${MONGO_PASSWORD}" ]]; then
        log_info "Testing MongoDB authentication as ${MONGO_USER}..."
        if docker compose ${COMPOSE_FILES} exec -T mongo mongosh \
            -u "${MONGO_USER}" -p "${MONGO_PASSWORD}" \
            --authenticationDatabase admin \
            --eval "db.adminCommand('ping')" &>/dev/null; then
            log_success "MongoDB authentication successful (authSource=admin)"
        else
            log_error "MongoDB authentication failed"
            log_error "User: ${MONGO_USER}"
            log_error "AuthSource: admin"
            log_error ""
            log_error "This is the most common cause of 'Command createIndexes requires authentication'"
            log_error ""
            log_error "To fix this, run:"
            log_error "  bash scripts/fix-mongo-user.sh"
        fi
        
        # Also test with authSource=bires (in case of misconfiguration)
        if docker compose ${COMPOSE_FILES} exec -T mongo mongosh \
            -u "${MONGO_USER}" -p "${MONGO_PASSWORD}" \
            --authenticationDatabase bires \
            --eval "db.adminCommand('ping')" &>/dev/null; then
            log_warning "Authentication works with authSource=bires (but should be admin)"
            log_warning "Update MONGO_URL to: mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongo:27017/bires?authSource=admin"
        fi
    fi
else
    log_error "MongoDB is not responding"
fi
echo ""

# 3. Check Redis
log_info "Testing Redis connection..."
if docker compose ${COMPOSE_FILES} exec -T redis redis-cli ping &>/dev/null; then
    log_success "Redis is responding (no auth)"
    
    # Check if password is required
    if [[ -n "${REDIS_PASSWORD}" ]]; then
        log_info "Testing Redis authentication..."
        if docker compose ${COMPOSE_FILES} exec -T redis redis-cli -a "${REDIS_PASSWORD}" ping &>/dev/null; then
            log_success "Redis authentication successful"
        else
            log_error "Redis authentication failed"
            log_error "Check REDIS_PASSWORD in .env file"
        fi
    fi
else
    log_error "Redis is not responding"
fi
echo ""

# 4. Check MinIO
log_info "Testing MinIO connection..."
if docker compose ${COMPOSE_FILES} exec -T minio curl -s http://localhost:9000/minio/health/live &>/dev/null; then
    log_success "MinIO is responding"
    
    log_info "Testing MinIO authentication..."
    if [[ -n "${MINIO_ACCESS_KEY}" ]] && [[ -n "${MINIO_SECRET_KEY}" ]]; then
        # Try to list buckets using mc client if available
        if docker compose ${COMPOSE_FILES} exec -T minio mc alias set test http://localhost:9000 \
            "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" &>/dev/null; then
            log_success "MinIO authentication successful"
            
            # Check if buckets exist
            log_info "Checking MinIO buckets..."
            docker compose ${COMPOSE_FILES} exec -T minio mc ls test/ 2>/dev/null || true
        else
            log_error "MinIO authentication failed"
            log_error "Check MINIO_ACCESS_KEY and MINIO_SECRET_KEY in .env file"
        fi
    fi
else
    log_error "MinIO is not responding"
fi
echo ""

# 5. Check backend container
log_info "Checking backend container..."
if docker compose ${COMPOSE_FILES} ps backend 2>/dev/null | grep -q "Up"; then
    log_success "Backend container is running"
    
    log_info "Testing backend health endpoint..."
    if curl -s http://localhost:8000/api/health &>/dev/null; then
        log_success "Backend health endpoint is responding"
        curl -s http://localhost:8000/api/health | python3 -m json.tool || true
    else
        log_error "Backend health endpoint is not responding"
        log_info "This usually means backend failed to connect to dependencies"
    fi
else
    log_error "Backend container is not running"
fi
echo ""

# 6. Check backend logs
log_info "Recent backend logs:"
echo "================================================================"
docker compose ${COMPOSE_FILES} logs --tail=50 backend
echo "================================================================"
echo ""

# 7. Network connectivity check
log_info "Testing network connectivity between containers..."

# Check if backend can reach mongo
log_info "Can backend reach MongoDB?"
if docker compose ${COMPOSE_FILES} exec -T backend sh -c "ping -c 3 mongo" &>/dev/null; then
    log_success "Backend can reach MongoDB host"
else
    log_warning "Backend cannot reach MongoDB host (this might be normal if ping is disabled)"
fi

# Check if backend can reach redis
log_info "Can backend reach Redis?"
if docker compose ${COMPOSE_FILES} exec -T backend sh -c "ping -c 3 redis" &>/dev/null; then
    log_success "Backend can reach Redis host"
else
    log_warning "Backend cannot reach Redis host (this might be normal if ping is disabled)"
fi

# Check if backend can reach minio
log_info "Can backend reach MinIO?"
if docker compose ${COMPOSE_FILES} exec -T backend sh -c "ping -c 3 minio" &>/dev/null; then
    log_success "Backend can reach MinIO host"
else
    log_warning "Backend cannot reach MinIO host (this might be normal if ping is disabled)"
fi

echo ""
echo "================================================================"
echo "Diagnostics complete"
echo "================================================================"
