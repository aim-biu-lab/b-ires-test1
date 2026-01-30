#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 02: Docker Setup
# =============================================================================
# Installs Docker CE and Docker Compose following official Docker installation
# guide for Ubuntu.
# =============================================================================

# Module info
MODULE_NAME="docker_setup"
MODULE_TITLE="Docker Installation"
MODULE_NUMBER=2

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/state-manager.sh"
source "${SCRIPT_DIR}/lib/config-parser.sh"

# =============================================================================
# Module Functions
# =============================================================================

should_run() {
    if is_step_done "${MODULE_NAME}"; then
        log_info "Docker setup already completed"
        return 1
    fi
    return 0
}

get_description() {
    cat << EOF
  - Remove old Docker versions (if any)
  - Install Docker prerequisites
  - Add Docker's official GPG key
  - Set up Docker repository
  - Install Docker CE, CLI, and Compose plugin
  - Configure Docker for production use
  - Add user to docker group
EOF
}

# =============================================================================
# Docker Installation
# =============================================================================

do_remove_old_docker() {
    log_info "Removing old Docker versions (if any)..."
    
    local old_packages=(
        docker
        docker-engine
        docker.io
        containerd
        runc
        docker-compose
        docker-compose-plugin
    )
    
    for pkg in "${old_packages[@]}"; do
        run_sudo apt-get remove -y "${pkg}" 2>/dev/null || true
    done
    
    log_success "Old Docker versions removed"
}

do_install_prerequisites() {
    log_info "Installing Docker prerequisites..."
    
    wait_for_apt
    
    run_sudo apt-get update -y
    run_sudo apt-get install -y \
        ca-certificates \
        curl \
        gnupg \
        lsb-release
    
    log_success "Docker prerequisites installed"
}

do_add_docker_repo() {
    log_info "Adding Docker's official GPG key and repository..."
    
    # Create keyrings directory
    run_sudo mkdir -p /etc/apt/keyrings
    
    # Add Docker's official GPG key
    if [[ ! -f /etc/apt/keyrings/docker.gpg ]]; then
        curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
            run_sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        run_sudo chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    
    # Set up repository
    local arch
    arch=$(dpkg --print-architecture)
    local codename
    codename=$(lsb_release -cs)
    
    echo "deb [arch=${arch} signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${codename} stable" | \
        run_sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
    
    log_success "Docker repository added"
}

do_install_docker() {
    log_info "Installing Docker CE..."
    
    wait_for_apt
    run_sudo apt-get update -y
    
    run_sudo apt-get install -y \
        docker-ce \
        docker-ce-cli \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin
    
    log_success "Docker CE installed"
}

do_configure_docker() {
    log_info "Configuring Docker for production use..."
    
    # Create Docker daemon configuration
    run_sudo mkdir -p /etc/docker
    
    run_sudo tee /etc/docker/daemon.json > /dev/null << 'EOF'
{
    "log-driver": "json-file",
    "log-opts": {
        "max-size": "10m",
        "max-file": "3"
    },
    "storage-driver": "overlay2",
    "live-restore": true
}
EOF
    
    # Reload Docker daemon
    run_sudo systemctl daemon-reload
    run_sudo systemctl restart docker
    
    log_success "Docker configured for production"
}

do_add_user_to_docker_group() {
    local username
    username=$(get_config "create_user" "bires")
    
    if [[ -z "${username}" ]]; then
        username=$(config_get "CREATE_USER" "bires")
    fi
    
    log_info "Adding '${username}' to docker group..."
    
    # Create docker group if it doesn't exist
    if ! getent group docker > /dev/null; then
        run_sudo groupadd docker
    fi
    
    # Add user to docker group
    run_sudo usermod -aG docker "${username}"
    
    # Also add current user if different
    if [[ "$(whoami)" != "${username}" && "$(whoami)" != "root" ]]; then
        run_sudo usermod -aG docker "$(whoami)"
    fi
    
    log_success "User '${username}' added to docker group"
}

do_enable_docker_service() {
    log_info "Enabling Docker service..."
    
    run_sudo systemctl enable docker
    run_sudo systemctl enable containerd
    
    # Start Docker if not running
    if ! run_sudo systemctl is-active --quiet docker; then
        run_sudo systemctl start docker
    fi
    
    log_success "Docker service enabled and running"
}

do_verify_installation() {
    log_info "Verifying Docker installation..."
    
    # Check Docker version
    local docker_version
    docker_version=$(docker --version 2>/dev/null)
    if [[ -z "${docker_version}" ]]; then
        log_error "Docker installation verification failed"
        return 1
    fi
    log_info "Docker version: ${docker_version}"
    
    # Check Docker Compose version
    local compose_version
    compose_version=$(docker compose version 2>/dev/null)
    if [[ -z "${compose_version}" ]]; then
        log_error "Docker Compose installation verification failed"
        return 1
    fi
    log_info "Docker Compose version: ${compose_version}"
    
    # Save versions to state
    save_config "docker_version" "${docker_version}"
    save_config "compose_version" "${compose_version}"
    
    # Run hello-world test (optional, only in non-low-profile mode)
    if ! is_low_profile_mode; then
        log_info "Running Docker hello-world test..."
        if run_sudo docker run --rm hello-world > /dev/null 2>&1; then
            log_success "Docker hello-world test passed"
        else
            log_warning "Docker hello-world test failed (may be OK if no internet)"
        fi
    fi
    
    log_success "Docker installation verified"
}

# =============================================================================
# Main Module Execution
# =============================================================================

run_module() {
    log_step "${MODULE_NUMBER}" "${MODULE_TITLE}"
    
    if ! should_run; then
        return 0
    fi
    
    # Check if Docker is already installed and working
    if command -v docker &> /dev/null && docker --version &> /dev/null; then
        log_info "Docker is already installed"
        
        if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
            if ! ask_yes_no "Docker is already installed. Reinstall?"; then
                # Just verify and configure
                do_configure_docker
                do_add_user_to_docker_group
                do_enable_docker_service
                do_verify_installation
                mark_step_completed "${MODULE_NAME}"
                return 0
            fi
        fi
    fi
    
    # Show description and ask for confirmation
    if ! ask_step_action "${MODULE_TITLE}" "$(get_description)"; then
        case $? in
            1) mark_step_skipped "${MODULE_NAME}"; return 0 ;;
            2) return 2 ;;
        esac
    fi
    
    mark_step_started "${MODULE_NAME}"
    
    # Execute steps
    local steps=(
        "do_remove_old_docker:Removing old Docker versions"
        "do_install_prerequisites:Installing prerequisites"
        "do_add_docker_repo:Adding Docker repository"
        "do_install_docker:Installing Docker CE"
        "do_configure_docker:Configuring Docker"
        "do_add_user_to_docker_group:Adding user to docker group"
        "do_enable_docker_service:Enabling Docker service"
        "do_verify_installation:Verifying installation"
    )
    
    for step in "${steps[@]}"; do
        local func="${step%%:*}"
        local desc="${step#*:}"
        
        log_info "${desc}..."
        
        if ! ${func}; then
            log_error "Failed: ${desc}"
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
    done
    
    mark_step_completed "${MODULE_NAME}"
    
    log_success "Docker installation completed!"
    
    echo ""
    echo -e "${COLOR_YELLOW}Note: You may need to log out and back in for docker group changes to take effect.${COLOR_NC}"
    echo ""
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
