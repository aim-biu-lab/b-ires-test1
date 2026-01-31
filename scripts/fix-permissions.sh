#!/bin/bash
# =============================================================================
# B-IRES Platform - Fix Permissions Script
# =============================================================================
# Fixes file ownership for the project directory, ensuring the bires user
# can perform git operations and other file modifications.
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
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "${SCRIPT_DIR}")"

# Detect project owner (the user who owns the project directory)
detect_project_owner() {
    local owner
    
    # Try to get from .env file
    if [[ -f "${PROJECT_DIR}/.env" ]]; then
        owner=$(stat -c '%U' "${PROJECT_DIR}/.env" 2>/dev/null || stat -f '%Su' "${PROJECT_DIR}/.env" 2>/dev/null)
    fi
    
    # Fallback to directory owner
    if [[ -z "${owner}" || "${owner}" == "root" ]]; then
        owner=$(stat -c '%U' "${PROJECT_DIR}" 2>/dev/null || stat -f '%Su' "${PROJECT_DIR}" 2>/dev/null)
    fi
    
    # Fallback to parent directory name (usually /home/username/bires)
    if [[ -z "${owner}" || "${owner}" == "root" ]]; then
        owner=$(basename "$(dirname "${PROJECT_DIR}")")
    fi
    
    # Final fallback
    if [[ -z "${owner}" || "${owner}" == "root" ]]; then
        owner="bires"
    fi
    
    echo "${owner}"
}

# Check if running as root or with sudo
check_permissions() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run with sudo"
        echo "Usage: sudo $0"
        exit 1
    fi
}

# Fix ownership of project files
fix_project_permissions() {
    local owner="$1"
    
    log_info "Fixing permissions for user: ${owner}"
    log_info "Project directory: ${PROJECT_DIR}"
    
    # Check if user exists
    if ! id "${owner}" &>/dev/null; then
        log_error "User '${owner}' does not exist"
        exit 1
    fi
    
    # Fix .git directory (most common issue)
    if [[ -d "${PROJECT_DIR}/.git" ]]; then
        log_info "Fixing .git directory ownership..."
        chown -R "${owner}:${owner}" "${PROJECT_DIR}/.git"
    fi
    
    # Fix entire project directory
    log_info "Fixing project directory ownership..."
    chown -R "${owner}:${owner}" "${PROJECT_DIR}"
    
    # Make scripts executable
    if [[ -d "${PROJECT_DIR}/scripts" ]]; then
        log_info "Making scripts executable..."
        find "${PROJECT_DIR}/scripts" -name "*.sh" -exec chmod +x {} \;
    fi
    
    # Fix nginx directory permissions
    if [[ -d "${PROJECT_DIR}/nginx" ]]; then
        chmod 755 -R "${PROJECT_DIR}/nginx/"
    fi
    
    log_success "Permissions fixed successfully"
}

# Main
main() {
    echo ""
    echo "========================================="
    echo "  B-IRES Permission Fix Utility"
    echo "========================================="
    echo ""
    
    check_permissions
    
    local owner
    owner=$(detect_project_owner)
    
    # Allow override via argument
    if [[ -n "$1" ]]; then
        owner="$1"
    fi
    
    fix_project_permissions "${owner}"
    
    echo ""
    log_info "You can now run git and other commands as '${owner}'"
    echo ""
}

main "$@"
