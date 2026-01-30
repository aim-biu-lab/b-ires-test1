#!/bin/bash
# =============================================================================
# B-IRES Platform - One-Liner Installation Bootstrap Script
# =============================================================================
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/bires/main/scripts/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/YOUR_ORG/bires/main/scripts/install.sh | bash -s -- --config /path/to/config.txt
#
# Options:
#   --config FILE       Use configuration file for unattended installation
#   --low-profile       Enable low-memory mode (for 2GB RAM instances)
#   --non-interactive   Run without prompts (requires --config)
#   --help              Show this help message
# =============================================================================

set -e

# Version
readonly INSTALLER_VERSION="1.0.0"

# URLs - Update these with your actual repository URLs
readonly GITHUB_RAW_BASE="${BIRES_GITHUB_RAW:-https://raw.githubusercontent.com/aim-biu-lab/b-ires-test1/master}"
readonly GITHUB_REPO="${BIRES_GITHUB_REPO:-https://github.com/aim-biu-lab/b-ires-test1.git}"

# Installer directory
readonly INSTALLER_DIR="/tmp/bires-installer"
readonly STATE_DIR="/var/lib/bires"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# =============================================================================
# Helper Functions
# =============================================================================

print_banner() {
    echo -e "${CYAN}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    ██████╗       ██╗██████╗ ███████╗███████╗                ║
║    ██╔══██╗      ██║██╔══██╗██╔════╝██╔════╝                ║
║    ██████╔╝█████╗██║██████╔╝█████╗  ███████╗                ║
║    ██╔══██╗╚════╝██║██╔══██╗██╔══╝  ╚════██║                ║
║    ██████╔╝      ██║██║  ██║███████╗███████║                ║
║    ╚═════╝       ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝                ║
║                                                              ║
║         Bar-Ilan Research Evaluation System                  ║
║              Installation Bootstrap Script                   ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${NC}"
    echo -e "${BOLD}Version: ${INSTALLER_VERSION}${NC}"
    echo ""
}

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

show_help() {
    cat << EOF
B-IRES Platform Installation Script v${INSTALLER_VERSION}

Usage:
  curl -fsSL <URL>/install.sh | bash
  curl -fsSL <URL>/install.sh | bash -s -- [OPTIONS]

Options:
  --config FILE       Use configuration file for unattended installation
  --low-profile       Enable low-memory mode (for 2GB RAM instances)
  --non-interactive   Run without prompts (requires --config)
  --local             Use local installer files (for development)
  --help              Show this help message

Environment Variables:
  BIRES_GITHUB_RAW    Override GitHub raw content URL
  BIRES_GITHUB_REPO   Override GitHub repository URL

Examples:
  # Interactive installation
  curl -fsSL https://example.com/install.sh | bash

  # Unattended installation with config file
  curl -fsSL https://example.com/install.sh | bash -s -- --config config.txt

  # Low-memory mode for 2GB instances
  curl -fsSL https://example.com/install.sh | bash -s -- --low-profile

EOF
}

# =============================================================================
# System Detection Functions
# =============================================================================

detect_os() {
    if [[ -f /etc/os-release ]]; then
        . /etc/os-release
        OS_NAME="${ID}"
        OS_VERSION="${VERSION_ID}"
        OS_PRETTY="${PRETTY_NAME}"
    else
        log_error "Cannot detect operating system. /etc/os-release not found."
        exit 1
    fi
}

check_ubuntu() {
    detect_os
    
    if [[ "${OS_NAME}" != "ubuntu" ]]; then
        log_error "This installer only supports Ubuntu."
        log_error "Detected: ${OS_PRETTY}"
        exit 1
    fi
    
    # Check supported versions
    case "${OS_VERSION}" in
        20.04|22.04|24.04)
            log_info "Detected: ${OS_PRETTY}"
            ;;
        *)
            log_warning "Ubuntu ${OS_VERSION} is not officially tested."
            log_warning "Supported versions: 20.04, 22.04, 24.04"
            if [[ -t 0 ]]; then
                read -p "Continue anyway? [y/N]: " -r
                if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                    exit 1
                fi
            else
                log_info "Non-interactive mode detected, continuing with unsupported version..."
            fi
            ;;
    esac
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        if command -v sudo &> /dev/null; then
            log_info "Script will use sudo for privileged operations."
            SUDO="sudo"
        else
            log_error "This script must be run as root or with sudo access."
            exit 1
        fi
    else
        SUDO=""
        log_info "Running as root."
    fi
}

check_memory() {
    local total_mem_kb
    total_mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    local total_mem_gb=$((total_mem_kb / 1024 / 1024))
    
    log_info "Detected RAM: ${total_mem_gb}GB"
    
    if [[ ${total_mem_gb} -lt 2 ]]; then
        log_error "Minimum 2GB RAM required. Detected: ${total_mem_gb}GB"
        exit 1
    elif [[ ${total_mem_gb} -lt 4 ]]; then
        log_warning "Low memory detected (${total_mem_gb}GB). Low-profile mode recommended."
        if [[ "${LOW_PROFILE}" != "true" ]]; then
            if [[ -t 0 ]]; then
                read -p "Enable low-profile mode? [Y/n]: " -r
                if [[ ! $REPLY =~ ^[Nn]$ ]]; then
                    LOW_PROFILE="true"
                    log_info "Low-profile mode enabled."
                fi
            else
                # Non-interactive mode: auto-enable low-profile for low memory
                LOW_PROFILE="true"
                log_info "Non-interactive mode: Auto-enabling low-profile mode for low memory."
            fi
        fi
    fi
}

check_disk_space() {
    local available_gb
    available_gb=$(df -BG / | awk 'NR==2 {print $4}' | sed 's/G//')
    
    log_info "Available disk space: ${available_gb}GB"
    
    if [[ ${available_gb} -lt 20 ]]; then
        log_warning "Less than 20GB disk space available."
        log_warning "Recommended: 40GB+ for production use."
        if [[ -t 0 ]]; then
            read -p "Continue anyway? [y/N]: " -r
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        else
            log_info "Non-interactive mode detected, continuing with low disk space..."
        fi
    fi
}

check_internet() {
    log_info "Checking internet connectivity..."
    
    if ! ping -c 1 github.com &> /dev/null; then
        if ! ping -c 1 8.8.8.8 &> /dev/null; then
            log_error "No internet connection detected."
            exit 1
        else
            log_warning "DNS resolution may have issues, but connectivity exists."
        fi
    fi
    
    log_success "Internet connectivity confirmed."
}

# =============================================================================
# Installer Download Functions
# =============================================================================

download_installer() {
    log_info "Downloading B-IRES installer..."
    
    # Create installer directory
    ${SUDO} mkdir -p "${INSTALLER_DIR}"
    ${SUDO} chmod 755 "${INSTALLER_DIR}"
    
    # Create state directory
    ${SUDO} mkdir -p "${STATE_DIR}"
    ${SUDO} chmod 700 "${STATE_DIR}"
    
    # List of files to download
    local files=(
        "scripts/installer/bires-setup.sh"
        "scripts/installer/lib/common.sh"
        "scripts/installer/lib/state-manager.sh"
        "scripts/installer/lib/config-parser.sh"
        "scripts/installer/lib/password-generator.sh"
        "scripts/installer/modules/01-security-setup.sh"
        "scripts/installer/modules/02-docker-setup.sh"
        "scripts/installer/modules/03-clone-project.sh"
        "scripts/installer/modules/04-configure-env.sh"
        "scripts/installer/modules/05-ssl-setup.sh"
        "scripts/installer/modules/06-nginx-config.sh"
        "scripts/installer/modules/07-deploy-app.sh"
        "scripts/installer/modules/08-admin-user.sh"
        "scripts/installer/modules/09-firewall-setup.sh"
        "scripts/installer/modules/10-netdata-setup.sh"
    )
    
    # Create directory structure
    ${SUDO} mkdir -p "${INSTALLER_DIR}/lib"
    ${SUDO} mkdir -p "${INSTALLER_DIR}/modules"
    
    # Download each file
    for file in "${files[@]}"; do
        local filename
        filename=$(basename "${file}")
        local target_dir="${INSTALLER_DIR}"
        
        if [[ "${file}" == *"/lib/"* ]]; then
            target_dir="${INSTALLER_DIR}/lib"
        elif [[ "${file}" == *"/modules/"* ]]; then
            target_dir="${INSTALLER_DIR}/modules"
        fi
        
        log_info "Downloading ${filename}..."
        
        if ! ${SUDO} curl -fsSL "${GITHUB_RAW_BASE}/${file}" -o "${target_dir}/${filename}"; then
            log_error "Failed to download ${file}"
            exit 1
        fi
        
        ${SUDO} chmod +x "${target_dir}/${filename}"
    done
    
    log_success "Installer downloaded successfully."
}

use_local_installer() {
    log_info "Using local installer files..."
    
    # Get the directory where this script is located
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    
    if [[ -d "${script_dir}/installer" ]]; then
        ${SUDO} mkdir -p "${INSTALLER_DIR}"
        ${SUDO} cp -r "${script_dir}/installer/"* "${INSTALLER_DIR}/"
        ${SUDO} chmod -R +x "${INSTALLER_DIR}"
        log_success "Local installer files copied."
    else
        log_error "Local installer directory not found: ${script_dir}/installer"
        exit 1
    fi
}

# =============================================================================
# Main Execution
# =============================================================================

main() {
    # Parse command line arguments
    CONFIG_FILE=""
    LOW_PROFILE="false"
    NON_INTERACTIVE="false"
    USE_LOCAL="false"
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            --low-profile)
                LOW_PROFILE="true"
                shift
                ;;
            --non-interactive)
                NON_INTERACTIVE="true"
                shift
                ;;
            --local)
                USE_LOCAL="true"
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Validate options
    if [[ "${NON_INTERACTIVE}" == "true" && -z "${CONFIG_FILE}" ]]; then
        log_error "--non-interactive requires --config option"
        exit 1
    fi
    
    if [[ -n "${CONFIG_FILE}" && ! -f "${CONFIG_FILE}" ]]; then
        log_error "Config file not found: ${CONFIG_FILE}"
        exit 1
    fi
    
    # Print banner
    print_banner
    
    # System checks
    log_info "Performing system checks..."
    echo ""
    
    check_ubuntu
    check_root
    check_memory
    check_disk_space
    check_internet
    
    echo ""
    log_success "All system checks passed!"
    echo ""
    
    # Download or use local installer
    if [[ "${USE_LOCAL}" == "true" ]]; then
        use_local_installer
    else
        download_installer
    fi
    
    echo ""
    log_info "Starting B-IRES installation wizard..."
    echo ""
    
    # Build arguments for main installer
    local installer_args=()
    
    if [[ -n "${CONFIG_FILE}" ]]; then
        # Copy config file to installer directory
        ${SUDO} cp "${CONFIG_FILE}" "${INSTALLER_DIR}/config.txt"
        installer_args+=("--config" "${INSTALLER_DIR}/config.txt")
    fi
    
    if [[ "${LOW_PROFILE}" == "true" ]]; then
        installer_args+=("--low-profile")
    fi
    
    if [[ "${NON_INTERACTIVE}" == "true" ]]; then
        installer_args+=("--non-interactive")
    fi
    
    # Export variables for main installer
    export BIRES_GITHUB_REPO="${GITHUB_REPO}"
    export BIRES_INSTALLER_DIR="${INSTALLER_DIR}"
    export BIRES_STATE_DIR="${STATE_DIR}"
    
    # Run main installer
    ${SUDO} bash "${INSTALLER_DIR}/bires-setup.sh" "${installer_args[@]}"
}

# Run main function with all arguments
main "$@"
