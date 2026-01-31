#!/bin/bash
# =============================================================================
# B-IRES MongoDB User Fix Script
# =============================================================================
# This script fixes MongoDB authentication issues by recreating the
# application user with the credentials from the .env file.
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

echo "================================================================"
echo "B-IRES MongoDB User Fix"
echo "================================================================"
echo ""

# Check if .env file exists
if [[ ! -f ".env" ]]; then
    log_error ".env file not found. Please run this from the project directory."
    exit 1
fi

# Load environment variables
source .env

# Check required variables
if [[ -z "${MONGO_ADMIN_PASSWORD}" ]]; then
    log_error "MONGO_ADMIN_PASSWORD not found in .env"
    exit 1
fi

if [[ -z "${MONGO_USER}" ]]; then
    log_error "MONGO_USER not found in .env"
    exit 1
fi

if [[ -z "${MONGO_PASSWORD}" ]]; then
    log_error "MONGO_PASSWORD not found in .env"
    exit 1
fi

COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"

# Check if MongoDB is running
log_info "Checking if MongoDB is running..."
if ! docker compose ${COMPOSE_FILES} ps mongo | grep -q "Up"; then
    log_error "MongoDB container is not running"
    log_info "Starting MongoDB..."
    docker compose ${COMPOSE_FILES} up -d mongo
    sleep 10
fi

log_success "MongoDB is running"
echo ""

# Test root connection
log_info "Testing root connection..."
if docker compose ${COMPOSE_FILES} exec -T mongo mongosh \
    -u admin -p "${MONGO_ADMIN_PASSWORD}" \
    --authenticationDatabase admin \
    --eval "db.adminCommand('ping')" &>/dev/null; then
    log_success "Root connection successful"
else
    log_error "Cannot connect as root admin"
    log_error "This likely means MONGO_ADMIN_PASSWORD in .env doesn't match what's in MongoDB"
    log_error ""
    log_error "Options:"
    log_error "  1. Find the correct MONGO_ADMIN_PASSWORD and update .env"
    log_error "  2. Delete and recreate MongoDB (WARNING: loses all data):"
    log_error "     docker compose ${COMPOSE_FILES} down -v"
    log_error "     docker compose ${COMPOSE_FILES} up -d"
    exit 1
fi
echo ""

# Check if application user exists and has correct password
log_info "Testing application user connection..."
if docker compose ${COMPOSE_FILES} exec -T mongo mongosh \
    -u "${MONGO_USER}" -p "${MONGO_PASSWORD}" \
    --authenticationDatabase admin \
    --eval "db.adminCommand('ping')" &>/dev/null; then
    log_success "Application user already has correct credentials"
    log_success "No fix needed!"
    echo ""
    log_info "If backend still can't connect, check:"
    log_info "  1. MONGO_URL in .env matches: mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongo:27017/bires?authSource=admin"
    log_info "  2. Backend container has the latest .env: docker compose ${COMPOSE_FILES} restart backend"
    exit 0
fi

log_warning "Application user authentication failed"
log_info "Will update/create MongoDB user: ${MONGO_USER}"
echo ""

# Ask for confirmation
read -p "Update MongoDB user '${MONGO_USER}' with password from .env? [y/N]: " -r
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    log_info "Cancelled by user"
    exit 0
fi

# Create/update the user
log_info "Updating MongoDB user..."

docker compose ${COMPOSE_FILES} exec -T mongo mongosh \
    -u admin -p "${MONGO_ADMIN_PASSWORD}" \
    --authenticationDatabase admin \
    --eval "
    use admin;
    
    // Try to drop the old user if it exists
    try {
        db.dropUser('${MONGO_USER}');
        print('Dropped old user');
    } catch(e) {
        print('User did not exist or could not be dropped');
    }
    
    // Create the user
    db.createUser({
        user: '${MONGO_USER}',
        pwd: '${MONGO_PASSWORD}',
        roles: [
            { role: 'readWrite', db: 'bires' },
            { role: 'dbAdmin', db: 'bires' }
        ]
    });
    
    print('User created successfully');
    " || {
    log_error "Failed to create MongoDB user"
    exit 1
}

echo ""
log_success "MongoDB user updated successfully"
echo ""

# Verify the fix
log_info "Verifying fix..."
if docker compose ${COMPOSE_FILES} exec -T mongo mongosh \
    -u "${MONGO_USER}" -p "${MONGO_PASSWORD}" \
    --authenticationDatabase admin \
    --eval "db.adminCommand('ping')" &>/dev/null; then
    log_success "Verification successful! User can now connect"
else
    log_error "Verification failed. User still cannot connect"
    exit 1
fi

echo ""
log_info "Next steps:"
log_info "  1. Verify MONGO_URL in .env:"
log_info "     MONGO_URL=mongodb://${MONGO_USER}:${MONGO_PASSWORD}@mongo:27017/bires?authSource=admin"
log_info ""
log_info "  2. Restart backend to pick up changes:"
log_info "     docker compose ${COMPOSE_FILES} restart backend"
log_info ""
log_info "  3. Check backend logs:"
log_info "     docker compose ${COMPOSE_FILES} logs -f backend"

echo ""
echo "================================================================"
echo "MongoDB user fix complete"
echo "================================================================"
