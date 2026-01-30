#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 09: Firewall Setup
# =============================================================================
# Configures UFW firewall with strict rules allowing only required ports.
# =============================================================================

# Module info
MODULE_NAME="firewall_setup"
MODULE_TITLE="Configure Firewall"
MODULE_NUMBER=9

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
        log_info "Firewall setup already completed"
        return 1
    fi
    
    # Check if firewall setup is disabled in config
    if config_is_disabled "SETUP_FIREWALL"; then
        log_info "Firewall setup disabled in configuration"
        mark_step_skipped "${MODULE_NAME}"
        return 1
    fi
    
    return 0
}

get_description() {
    cat << EOF
  - Install and enable UFW (Uncomplicated Firewall)
  - Set default policies (deny incoming, allow outgoing)
  - Allow required ports:
    - SSH (22/tcp)
    - HTTP (80/tcp)
    - HTTPS (443/tcp)
    - Netdata (19999/tcp) - optional
  - Enable firewall
EOF
}

# =============================================================================
# Firewall Functions
# =============================================================================

do_install_ufw() {
    log_info "Checking UFW installation..."
    
    if ! command -v ufw &> /dev/null; then
        log_info "Installing UFW..."
        wait_for_apt
        run_sudo apt-get install -y ufw
    fi
    
    log_success "UFW is installed"
}

do_reset_ufw() {
    log_info "Resetting UFW to default state..."
    
    # Disable UFW first
    run_sudo ufw --force disable 2>/dev/null || true
    
    # Reset to defaults
    run_sudo ufw --force reset
    
    log_success "UFW reset to defaults"
}

do_set_defaults() {
    log_info "Setting default firewall policies..."
    
    # Default deny incoming
    run_sudo ufw default deny incoming
    
    # Default allow outgoing
    run_sudo ufw default allow outgoing
    
    log_success "Default policies set"
}

do_allow_ssh() {
    log_info "Allowing SSH (port 22)..."
    
    # Get SSH port (in case it's been changed)
    local ssh_port
    ssh_port=$(grep -E "^Port " /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}')
    ssh_port="${ssh_port:-22}"
    
    run_sudo ufw allow "${ssh_port}/tcp" comment "SSH"
    
    log_success "SSH allowed on port ${ssh_port}"
}

do_allow_http() {
    log_info "Allowing HTTP (port 80)..."
    
    run_sudo ufw allow 80/tcp comment "HTTP"
    
    log_success "HTTP allowed"
}

do_allow_https() {
    log_info "Allowing HTTPS (port 443)..."
    
    run_sudo ufw allow 443/tcp comment "HTTPS"
    
    log_success "HTTPS allowed"
}

do_allow_netdata() {
    local install_netdata
    install_netdata=$(config_get "INSTALL_NETDATA" "yes")
    
    if [[ "${install_netdata,,}" != "yes" && "${install_netdata,,}" != "true" ]]; then
        log_info "Netdata not configured, skipping port 19999"
        return 0
    fi
    
    log_info "Allowing Netdata (port 19999)..."
    
    # Ask if Netdata should be publicly accessible
    local allow_public="no"
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        echo ""
        echo "Netdata provides server monitoring at port 19999."
        echo "Options:"
        echo "  1) Allow from any IP (public access)"
        echo "  2) Allow from local network only (192.168.0.0/16, 10.0.0.0/8)"
        echo "  3) Don't allow external access (access via SSH tunnel only)"
        echo ""
        
        ask_choice "Select Netdata access level:" "Public|Local network|SSH tunnel only" "netdata_access" "Local network"
        
        case "${netdata_access}" in
            "Public")
                run_sudo ufw allow 19999/tcp comment "Netdata"
                log_success "Netdata port 19999 open to public"
                ;;
            "Local network")
                run_sudo ufw allow from 192.168.0.0/16 to any port 19999 comment "Netdata local"
                run_sudo ufw allow from 10.0.0.0/8 to any port 19999 comment "Netdata local"
                log_success "Netdata port 19999 open to local networks"
                ;;
            "SSH tunnel only")
                log_info "Netdata will only be accessible via SSH tunnel"
                log_info "Use: ssh -L 19999:localhost:19999 user@server"
                ;;
        esac
    else
        # Non-interactive: allow from local networks only
        run_sudo ufw allow from 192.168.0.0/16 to any port 19999 comment "Netdata local"
        run_sudo ufw allow from 10.0.0.0/8 to any port 19999 comment "Netdata local"
        log_success "Netdata port 19999 open to local networks"
    fi
    
    save_config "netdata_firewall" "${netdata_access:-Local network}"
}

do_allow_additional_ports() {
    local additional_ports
    additional_ports=$(config_get "ADDITIONAL_PORTS" "")
    
    if [[ -z "${additional_ports}" ]]; then
        return 0
    fi
    
    log_info "Configuring additional ports: ${additional_ports}"
    
    IFS=',' read -ra ports <<< "${additional_ports}"
    for port in "${ports[@]}"; do
        port=$(echo "${port}" | tr -d ' ')
        if [[ -n "${port}" ]]; then
            run_sudo ufw allow "${port}" comment "Custom port"
            log_info "Allowed port: ${port}"
        fi
    done
    
    log_success "Additional ports configured"
}

do_enable_ufw() {
    log_info "Enabling firewall..."
    
    # Important: Make sure SSH is allowed before enabling
    if ! run_sudo ufw status | grep -q "22/tcp.*ALLOW"; then
        log_warning "SSH may not be allowed! Adding SSH rule..."
        run_sudo ufw allow 22/tcp comment "SSH"
    fi
    
    # Enable UFW
    run_sudo ufw --force enable
    
    log_success "Firewall enabled"
}

do_show_status() {
    log_info "Firewall status:"
    echo ""
    run_sudo ufw status verbose
    echo ""
}

do_display_warning() {
    echo ""
    print_box "Firewall Warning" \
        "The firewall is now active with the following rules:" \
        "" \
        "  - SSH (22/tcp):    ALLOWED" \
        "  - HTTP (80/tcp):   ALLOWED" \
        "  - HTTPS (443/tcp): ALLOWED" \
        "" \
        "All other incoming connections are BLOCKED." \
        "" \
        "If you lose SSH access, use Linode's LISH console" \
        "to disable the firewall: sudo ufw disable"
    echo ""
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
    
    # Execute steps
    local steps=(
        "do_install_ufw:Installing UFW"
        "do_reset_ufw:Resetting UFW"
        "do_set_defaults:Setting default policies"
        "do_allow_ssh:Allowing SSH"
        "do_allow_http:Allowing HTTP"
        "do_allow_https:Allowing HTTPS"
        "do_allow_netdata:Configuring Netdata access"
        "do_allow_additional_ports:Configuring additional ports"
        "do_enable_ufw:Enabling firewall"
        "do_show_status:Showing status"
        "do_display_warning:Displaying warning"
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
    
    log_success "Firewall setup completed!"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
