#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 10: Netdata Setup
# =============================================================================
# Installs Netdata for real-time server monitoring.
# =============================================================================

# Module info
MODULE_NAME="netdata_setup"
MODULE_TITLE="Install Netdata Monitoring"
MODULE_NUMBER=10

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
        log_info "Netdata setup already completed"
        return 1
    fi
    
    # Check if Netdata installation is disabled in config
    if config_is_disabled "INSTALL_NETDATA"; then
        log_info "Netdata installation disabled in configuration"
        mark_step_skipped "${MODULE_NAME}"
        return 1
    fi
    
    return 0
}

get_description() {
    if is_low_profile_mode; then
        cat << EOF
  - Install Netdata with reduced collectors (low-profile mode)
  - Configure for minimal resource usage
  - Enable automatic startup
  - Access via: http://SERVER_IP:19999
EOF
    else
        cat << EOF
  - Install Netdata using official kickstart script
  - Enable all default collectors
  - Configure for Docker monitoring
  - Enable automatic startup
  - Access via: http://SERVER_IP:19999
EOF
    fi
}

# =============================================================================
# Netdata Functions
# =============================================================================

do_check_existing() {
    if command -v netdata &> /dev/null; then
        log_info "Netdata is already installed"
        
        local version
        version=$(netdata -v 2>/dev/null | head -1)
        log_info "Version: ${version}"
        
        if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
            if ! ask_yes_no "Netdata is already installed. Reinstall?"; then
                log_info "Keeping existing Netdata installation"
                return 1
            fi
        else
            return 1
        fi
    fi
    
    return 0
}

do_install_netdata_normal() {
    log_info "Installing Netdata..."
    
    # Download and run the kickstart script
    # Using the non-interactive mode
    local kickstart_args=(
        "--non-interactive"
        "--stable-channel"
    )
    
    # Add claim token if provided
    local claim_token
    claim_token=$(config_get "NETDATA_CLAIM_TOKEN" "")
    local claim_rooms
    claim_rooms=$(config_get "NETDATA_CLAIM_ROOMS" "")
    
    if [[ -n "${claim_token}" ]]; then
        kickstart_args+=("--claim-token" "${claim_token}")
        if [[ -n "${claim_rooms}" ]]; then
            kickstart_args+=("--claim-rooms" "${claim_rooms}")
        fi
    fi
    
    # Download and execute kickstart script
    curl -fsSL https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh
    
    if [[ ! -f /tmp/netdata-kickstart.sh ]]; then
        log_error "Failed to download Netdata kickstart script"
        return 1
    fi
    
    run_sudo bash /tmp/netdata-kickstart.sh "${kickstart_args[@]}"
    
    rm -f /tmp/netdata-kickstart.sh
    
    log_success "Netdata installed"
}

do_install_netdata_low_profile() {
    log_info "Installing Netdata (low-profile mode)..."
    
    # Install with minimal collectors for low memory systems
    local kickstart_args=(
        "--non-interactive"
        "--stable-channel"
    )
    
    curl -fsSL https://get.netdata.cloud/kickstart.sh > /tmp/netdata-kickstart.sh
    
    if [[ ! -f /tmp/netdata-kickstart.sh ]]; then
        log_error "Failed to download Netdata kickstart script"
        return 1
    fi
    
    run_sudo bash /tmp/netdata-kickstart.sh "${kickstart_args[@]}"
    
    rm -f /tmp/netdata-kickstart.sh
    
    # Configure for low memory
    log_info "Configuring Netdata for low memory usage..."
    
    local netdata_conf="/etc/netdata/netdata.conf"
    
    if [[ -f "${netdata_conf}" ]]; then
        # Reduce history and update frequency
        run_sudo tee -a "${netdata_conf}" > /dev/null << 'EOF'

# Low profile configuration
[global]
    update every = 2
    memory mode = ram
    history = 1800

[web]
    web files group = netdata
    web files owner = netdata

[plugins]
    # Disable some heavy collectors
    cgroups = no
    apps = no
    
EOF
        
        # Restart Netdata to apply changes
        run_sudo systemctl restart netdata
    fi
    
    log_success "Netdata installed (low-profile)"
}

do_configure_docker_monitoring() {
    log_info "Configuring Docker monitoring..."
    
    # Add netdata user to docker group
    if getent group docker > /dev/null; then
        run_sudo usermod -aG docker netdata 2>/dev/null || true
    fi
    
    # Enable Docker collector
    local docker_conf="/etc/netdata/go.d/docker.conf"
    
    if [[ -d "/etc/netdata/go.d" ]]; then
        run_sudo tee "${docker_conf}" > /dev/null << 'EOF'
# Docker collector configuration
jobs:
  - name: local
    address: unix:///var/run/docker.sock
EOF
        run_sudo chmod 640 "${docker_conf}"
        run_sudo chown netdata:netdata "${docker_conf}" 2>/dev/null || true
    fi
    
    log_success "Docker monitoring configured"
}

do_enable_service() {
    log_info "Enabling Netdata service..."
    
    run_sudo systemctl enable netdata
    run_sudo systemctl start netdata
    
    # Wait for service to start
    sleep 3
    
    if systemctl is-active --quiet netdata; then
        log_success "Netdata service is running"
    else
        log_warning "Netdata service may not be running properly"
        run_sudo systemctl status netdata --no-pager || true
    fi
}

do_verify_installation() {
    log_info "Verifying Netdata installation..."
    
    # Check if Netdata is responding
    local max_wait=30
    local count=0
    
    while ! curl -s http://localhost:19999/api/v1/info &>/dev/null; do
        sleep 2
        ((count++))
        if [[ $count -ge $max_wait ]]; then
            log_warning "Netdata is not responding on port 19999"
            return 0  # Don't fail the module
        fi
    done
    
    # Get version info
    local info
    info=$(curl -s http://localhost:19999/api/v1/info 2>/dev/null)
    
    if [[ -n "${info}" ]]; then
        local version
        version=$(echo "${info}" | grep -o '"version":"[^"]*"' | cut -d'"' -f4)
        log_success "Netdata is running (version: ${version})"
    fi
    
    return 0
}

do_display_info() {
    local ip_address
    ip_address=$(get_config "ip_address" "")
    if [[ -z "${ip_address}" ]]; then
        ip_address=$(get_ip_address)
    fi
    
    echo ""
    print_box "Netdata Monitoring" \
        "Netdata has been installed and is running." \
        "" \
        "Access URL: http://${ip_address}:19999" \
        "" \
        "Features:" \
        "  - Real-time system metrics" \
        "  - Docker container monitoring" \
        "  - Disk, CPU, Memory, Network stats" \
        "" \
        "Note: Port 19999 access depends on firewall settings."
    echo ""
    
    save_config "netdata_url" "http://${ip_address}:19999"
}

# =============================================================================
# Main Module Execution
# =============================================================================

run_module() {
    log_step "${MODULE_NUMBER}" "${MODULE_TITLE}"
    
    if ! should_run; then
        return 0
    fi
    
    # Show description and ask for confirmation
    if ! ask_step_action "${MODULE_TITLE}" "$(get_description)"; then
        case $? in
            1) mark_step_skipped "${MODULE_NAME}"; return 0 ;;
            2) return 2 ;;
        esac
    fi
    
    mark_step_started "${MODULE_NAME}"
    
    # Check for existing installation
    if ! do_check_existing; then
        # Skip installation but still configure
        do_configure_docker_monitoring || true
        do_enable_service || true
        do_verify_installation || true
        do_display_info
        mark_step_completed "${MODULE_NAME}"
        return 0
    fi
    
    # Install based on mode
    if is_low_profile_mode; then
        if ! do_install_netdata_low_profile; then
            log_warning "Netdata installation failed, continuing without monitoring"
            mark_step_skipped "${MODULE_NAME}"
            return 0
        fi
    else
        if ! do_install_netdata_normal; then
            log_warning "Netdata installation failed, continuing without monitoring"
            mark_step_skipped "${MODULE_NAME}"
            return 0
        fi
    fi
    
    # Configure and verify
    do_configure_docker_monitoring || true
    do_enable_service || true
    do_verify_installation || true
    do_display_info
    
    mark_step_completed "${MODULE_NAME}"
    
    log_success "Netdata setup completed!"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
