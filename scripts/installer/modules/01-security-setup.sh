#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 01: Security Setup
# =============================================================================
# Implements server security hardening following Akamai/Linode best practices:
# - System updates
# - Create limited user with sudo
# - SSH key setup
# - SSH hardening (disable root login, password auth)
# - Set timezone and hostname
# - Install fail2ban
# =============================================================================

# Module info
MODULE_NAME="security_setup"
MODULE_TITLE="Server Security Setup"
MODULE_NUMBER=1

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/state-manager.sh"
source "${SCRIPT_DIR}/lib/config-parser.sh"

# =============================================================================
# Module Functions
# =============================================================================

# Check if this module should run
should_run() {
    # Check if already completed
    if is_step_done "${MODULE_NAME}"; then
        log_info "Security setup already completed"
        return 1
    fi
    
    # Check if security setup is disabled in config
    if config_is_disabled "SETUP_SECURITY"; then
        log_info "Security setup disabled in configuration"
        mark_step_skipped "${MODULE_NAME}"
        return 1
    fi
    
    return 0
}

# Get module description for user
get_description() {
    cat << EOF
  - Update system packages
  - Create a limited user account with sudo access
  - Configure SSH key authentication
  - Harden SSH (disable root login, password authentication)
  - Set system timezone
  - Set hostname
  - Install and configure fail2ban
EOF
}

# =============================================================================
# System Updates
# =============================================================================

do_system_update() {
    log_info "Updating system packages..."
    
    # Wait for any existing apt processes
    wait_for_apt
    
    # Update package lists
    run_sudo apt-get update -y
    
    # Upgrade packages (non-interactive)
    export DEBIAN_FRONTEND=noninteractive
    run_sudo apt-get upgrade -y -o Dpkg::Options::="--force-confdef" -o Dpkg::Options::="--force-confold"
    
    log_success "System packages updated"
}

# =============================================================================
# User Creation
# =============================================================================

do_create_user() {
    local username
    username=$(config_get "CREATE_USER" "bires")
    
    # Save username to state for other modules
    save_config "create_user" "${username}"
    export BIRES_USER="${username}"
    
    if id "${username}" &>/dev/null; then
        log_info "User '${username}' already exists"
        
        # Ensure user is in sudo group
        if ! groups "${username}" | grep -q sudo; then
            log_info "Adding ${username} to sudo group..."
            run_sudo usermod -aG sudo "${username}"
        fi
        
        return 0
    fi
    
    log_info "Creating user '${username}'..."
    
    # Create user with home directory
    run_sudo adduser --gecos "" --disabled-password "${username}"
    
    # Add to sudo group
    run_sudo usermod -aG sudo "${username}"
    
    # Set up passwordless sudo for initial setup (can be removed later)
    echo "${username} ALL=(ALL) NOPASSWD:ALL" | run_sudo tee "/etc/sudoers.d/${username}" > /dev/null
    run_sudo chmod 440 "/etc/sudoers.d/${username}"
    
    log_success "User '${username}' created and added to sudo group"
}

# =============================================================================
# SSH Key Setup
# =============================================================================

do_setup_ssh_keys() {
    local username
    username=$(config_get "CREATE_USER" "bires")
    local user_home="/home/${username}"
    local ssh_dir="${user_home}/.ssh"
    
    log_info "Setting up SSH keys for '${username}'..."
    
    # Create .ssh directory
    run_sudo mkdir -p "${ssh_dir}"
    
    # Get SSH public key from config or copy from root
    local ssh_public_key
    ssh_public_key=$(config_get "SSH_PUBLIC_KEY" "")
    
    if [[ -n "${ssh_public_key}" ]]; then
        # Use provided public key
        echo "${ssh_public_key}" | run_sudo tee "${ssh_dir}/authorized_keys" > /dev/null
        log_info "Added provided SSH public key"
    elif [[ -f /root/.ssh/authorized_keys ]]; then
        # Copy from root user
        run_sudo cp /root/.ssh/authorized_keys "${ssh_dir}/"
        log_info "Copied SSH keys from root user"
    elif [[ -f "${HOME}/.ssh/authorized_keys" ]]; then
        # Copy from current user
        run_sudo cp "${HOME}/.ssh/authorized_keys" "${ssh_dir}/"
        log_info "Copied SSH keys from current user"
    else
        log_warning "No SSH keys found to copy. You may need to add them manually."
        
        if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
            echo ""
            echo "You can paste your SSH public key now, or press Enter to skip:"
            read -r manual_key
            if [[ -n "${manual_key}" ]]; then
                echo "${manual_key}" | run_sudo tee "${ssh_dir}/authorized_keys" > /dev/null
                log_success "SSH key added"
            fi
        fi
    fi
    
    # Set correct permissions
    run_sudo chown -R "${username}:${username}" "${ssh_dir}"
    run_sudo chmod 700 "${ssh_dir}"
    [[ -f "${ssh_dir}/authorized_keys" ]] && run_sudo chmod 600 "${ssh_dir}/authorized_keys"
    
    log_success "SSH keys configured for '${username}'"
}

# =============================================================================
# SSH Hardening
# =============================================================================

do_harden_ssh() {
    log_info "Hardening SSH configuration..."
    
    local sshd_config="/etc/ssh/sshd_config"
    
    # Backup original config
    backup_file "${sshd_config}"
    
    # Function to update or add SSH config setting
    update_ssh_setting() {
        local key="$1"
        local value="$2"
        
        if grep -q "^${key}" "${sshd_config}"; then
            run_sudo sed -i "s/^${key}.*/${key} ${value}/" "${sshd_config}"
        elif grep -q "^#${key}" "${sshd_config}"; then
            run_sudo sed -i "s/^#${key}.*/${key} ${value}/" "${sshd_config}"
        else
            echo "${key} ${value}" | run_sudo tee -a "${sshd_config}" > /dev/null
        fi
    }
    
    # Disable root login (if enabled in config)
    if ! config_is_disabled "DISABLE_ROOT_LOGIN"; then
        update_ssh_setting "PermitRootLogin" "no"
        log_info "Root login disabled"
    fi
    
    # Disable password authentication (if enabled in config)
    if ! config_is_disabled "DISABLE_PASSWORD_AUTH"; then
        update_ssh_setting "PasswordAuthentication" "no"
        log_info "Password authentication disabled"
    fi
    
    # Enable public key authentication
    update_ssh_setting "PubkeyAuthentication" "yes"
    
    # Disable empty passwords
    update_ssh_setting "PermitEmptyPasswords" "no"
    
    # Disable X11 forwarding
    update_ssh_setting "X11Forwarding" "no"
    
    # Set max authentication tries
    update_ssh_setting "MaxAuthTries" "3"
    
    # Validate SSH config
    if run_sudo sshd -t; then
        # Restart SSH service
        run_sudo systemctl restart sshd
        log_success "SSH hardened and restarted"
    else
        log_error "SSH configuration validation failed!"
        log_warning "Restoring backup..."
        run_sudo cp "${BIRES_STATE_DIR}/backups/sshd_config."*.bak "${sshd_config}" 2>/dev/null
        return 1
    fi
}

# =============================================================================
# Timezone and Hostname
# =============================================================================

do_set_timezone() {
    local timezone
    timezone=$(config_get "TIMEZONE" "UTC")
    
    log_info "Setting timezone to ${timezone}..."
    
    run_sudo timedatectl set-timezone "${timezone}"
    
    log_success "Timezone set to ${timezone}"
}

do_set_hostname() {
    local hostname
    hostname=$(config_get "HOSTNAME" "")
    
    if [[ -z "${hostname}" ]]; then
        # Generate hostname from domain if available
        local domain
        domain=$(config_get "DOMAIN" "")
        if [[ -n "${domain}" ]]; then
            hostname="bires-$(echo "${domain}" | cut -d. -f1)"
        else
            hostname="bires-server"
        fi
    fi
    
    log_info "Setting hostname to ${hostname}..."
    
    run_sudo hostnamectl set-hostname "${hostname}"
    
    # Update /etc/hosts
    local ip_address
    ip_address=$(get_ip_address)
    
    if ! grep -q "${hostname}" /etc/hosts; then
        echo "${ip_address} ${hostname}" | run_sudo tee -a /etc/hosts > /dev/null
    fi
    
    # Save to state
    save_config "hostname" "${hostname}"
    save_config "ip_address" "${ip_address}"
    
    log_success "Hostname set to ${hostname}"
}

# =============================================================================
# Install Essential Packages
# =============================================================================

do_install_essentials() {
    log_info "Installing essential packages..."
    
    wait_for_apt
    
    local packages=(
        git
        curl
        wget
        htop
        nano
        vim
        unzip
        jq
        ca-certificates
        gnupg
        lsb-release
        software-properties-common
    )
    
    run_sudo apt-get install -y "${packages[@]}"
    
    log_success "Essential packages installed"
}

# =============================================================================
# Fail2ban Setup
# =============================================================================

do_setup_fail2ban() {
    log_info "Installing and configuring fail2ban..."
    
    wait_for_apt
    run_sudo apt-get install -y fail2ban
    
    # Create local configuration
    local jail_local="/etc/fail2ban/jail.local"
    
    run_sudo tee "${jail_local}" > /dev/null << 'EOF'
[DEFAULT]
# Ban hosts for 1 hour
bantime = 3600

# A host is banned if it has generated "maxretry" during the last "findtime" seconds.
findtime = 600
maxretry = 5

# Ignore local networks
ignoreip = 127.0.0.1/8 ::1

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
EOF
    
    # Enable and start fail2ban
    run_sudo systemctl enable fail2ban
    run_sudo systemctl restart fail2ban
    
    log_success "fail2ban installed and configured"
}

# =============================================================================
# Swap File (for low memory systems)
# =============================================================================

do_setup_swap() {
    # Check if low profile mode or low memory
    if ! is_low_profile_mode; then
        local total_mem_kb
        total_mem_kb=$(grep MemTotal /proc/meminfo | awk '{print $2}')
        local total_mem_gb=$((total_mem_kb / 1024 / 1024))
        
        if [[ ${total_mem_gb} -ge 4 ]]; then
            log_debug "Sufficient memory (${total_mem_gb}GB), skipping swap setup"
            return 0
        fi
    fi
    
    # Check if swap already exists
    if swapon --show | grep -q '/swapfile'; then
        log_info "Swap file already exists"
        return 0
    fi
    
    log_info "Creating swap file for low-memory system..."
    
    # Create 2GB swap file
    run_sudo fallocate -l 2G /swapfile
    run_sudo chmod 600 /swapfile
    run_sudo mkswap /swapfile
    run_sudo swapon /swapfile
    
    # Add to fstab for persistence
    if ! grep -q '/swapfile' /etc/fstab; then
        echo '/swapfile none swap sw 0 0' | run_sudo tee -a /etc/fstab > /dev/null
    fi
    
    # Configure swappiness
    run_sudo sysctl vm.swappiness=10
    echo 'vm.swappiness=10' | run_sudo tee -a /etc/sysctl.conf > /dev/null
    
    log_success "2GB swap file created and enabled"
}

# =============================================================================
# Main Module Execution
# =============================================================================

run_module() {
    log_step "${MODULE_NUMBER}" "${MODULE_TITLE}"
    
    # Check if should run
    if ! should_run; then
        return 0
    fi
    
    # Show description and ask for confirmation
    local action
    if ! ask_step_action "${MODULE_TITLE}" "$(get_description)"; then
        case $? in
            1) mark_step_skipped "${MODULE_NAME}"; return 0 ;;
            2) return 2 ;;  # Quit signal
        esac
    fi
    
    # Mark as in progress
    mark_step_started "${MODULE_NAME}"
    
    # Execute steps
    local steps=(
        "do_system_update:Updating system packages"
        "do_install_essentials:Installing essential packages"
        "do_create_user:Creating limited user"
        "do_setup_ssh_keys:Setting up SSH keys"
        "do_set_timezone:Setting timezone"
        "do_set_hostname:Setting hostname"
        "do_setup_swap:Setting up swap (if needed)"
        "do_setup_fail2ban:Installing fail2ban"
        "do_harden_ssh:Hardening SSH"
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
    
    # Mark as completed
    mark_step_completed "${MODULE_NAME}"
    
    log_success "Server security setup completed!"
    
    # Important notice about reconnecting
    local username
    username=$(config_get "CREATE_USER" "bires")
    
    echo ""
    print_box "Important Notice" \
        "SSH configuration has been updated." \
        "" \
        "If you're connected as root, please:" \
        "1. Open a NEW terminal window" \
        "2. Connect as: ssh ${username}@$(get_config "ip_address" "YOUR_IP")" \
        "3. Verify you can log in before closing this session" \
        "" \
        "The installation can be resumed by running:" \
        "  sudo bash ${BIRES_INSTALLER_DIR}/bires-setup.sh"
    echo ""
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
