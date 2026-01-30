#!/bin/bash
# =============================================================================
# B-IRES Platform - Production Restart Script
# =============================================================================
# Restarts all B-IRES services in production mode.
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

# Change to project directory
cd "${PROJECT_DIR}"

log_info "Restarting B-IRES services..."

# Run stop then start
bash "${SCRIPT_DIR}/stop-prod.sh"

echo ""

bash "${SCRIPT_DIR}/start-prod.sh"
