#!/bin/bash
# =============================================================================
# B-IRES Platform - Production Restart Script
# =============================================================================
# Restarts all B-IRES services in production mode.
#
# Options:
#   --fix-permissions    Fix file ownership before restarting (requires sudo)
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

# Parse arguments
FIX_PERMISSIONS=false
for arg in "$@"; do
    case $arg in
        --fix-permissions)
            FIX_PERMISSIONS=true
            shift
            ;;
    esac
done

# Change to project directory
cd "${PROJECT_DIR}"

# Fix permissions if requested
if [[ "${FIX_PERMISSIONS}" == "true" ]]; then
    log_info "Fixing file permissions..."
    if [[ $EUID -ne 0 ]]; then
        log_warning "Permission fix requires sudo, attempting..."
        sudo bash "${SCRIPT_DIR}/fix-permissions.sh"
    else
        bash "${SCRIPT_DIR}/fix-permissions.sh"
    fi
fi

log_info "Restarting B-IRES services..."

# Run stop then start
bash "${SCRIPT_DIR}/stop-prod.sh"

echo ""

bash "${SCRIPT_DIR}/start-prod.sh"
