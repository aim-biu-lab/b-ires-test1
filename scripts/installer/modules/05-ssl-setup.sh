#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 05: SSL/TLS Setup
# =============================================================================
# Installs Certbot and obtains SSL certificates from Let's Encrypt.
# =============================================================================

# Module info
MODULE_NAME="ssl_setup"
MODULE_TITLE="SSL Certificate Setup"
MODULE_NUMBER=5

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
        log_info "SSL setup already completed"
        return 1
    fi
    
    # Check if SSL is disabled in config
    if config_is_disabled "SETUP_SSL"; then
        log_info "SSL setup disabled in configuration"
        mark_step_skipped "${MODULE_NAME}"
        return 1
    fi
    
    return 0
}

get_description() {
    local domain
    domain=$(get_config "domain" "yourdomain.com")
    cat << EOF
  - Install Certbot (Let's Encrypt client)
  - Stop any services using port 80
  - Obtain SSL certificate for: ${domain}
  - Configure automatic certificate renewal
  - Create renewal hook for nginx restart
EOF
}

# =============================================================================
# SSL Functions
# =============================================================================

do_install_certbot() {
    log_info "Installing Certbot..."
    
    wait_for_apt
    
    # Install Certbot
    run_sudo apt-get update -y
    run_sudo apt-get install -y certbot
    
    # Verify installation
    if ! command -v certbot &> /dev/null; then
        log_error "Certbot installation failed"
        return 1
    fi
    
    local certbot_version
    certbot_version=$(certbot --version 2>&1)
    log_success "Certbot installed: ${certbot_version}"
}

do_stop_services_on_80() {
    log_info "Stopping services on port 80..."
    
    # Stop nginx if running (system nginx)
    if systemctl is-active --quiet nginx 2>/dev/null; then
        run_sudo systemctl stop nginx
    fi
    
    # Stop Docker containers that might use port 80
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    if [[ -n "${project_dir}" && -f "${project_dir}/docker-compose.yml" ]]; then
        cd "${project_dir}" || true
        docker compose down 2>/dev/null || true
        cd - > /dev/null || true
    fi
    
    # Check if port 80 is free
    if lsof -i :80 &>/dev/null; then
        log_warning "Port 80 is still in use. Attempting to free it..."
        
        # Try to kill processes on port 80
        local pids
        pids=$(lsof -ti :80 2>/dev/null)
        if [[ -n "${pids}" ]]; then
            echo "${pids}" | xargs -r run_sudo kill -9 2>/dev/null || true
            sleep 2
        fi
    fi
    
    # Final check
    if lsof -i :80 &>/dev/null; then
        log_error "Port 80 is still in use. Cannot obtain SSL certificate."
        log_error "Please manually stop the service using port 80 and try again."
        return 1
    fi
    
    log_success "Port 80 is free"
}

do_obtain_certificate() {
    local domain
    domain=$(get_config "domain" "")
    
    if [[ -z "${domain}" ]]; then
        log_error "Domain not configured. Cannot obtain SSL certificate."
        return 1
    fi
    
    # Get email for Let's Encrypt
    local ssl_email
    ssl_email=$(config_get "SSL_EMAIL" "")
    
    if [[ -z "${ssl_email}" ]]; then
        ssl_email=$(get_config "admin_email" "")
    fi
    
    if [[ -z "${ssl_email}" && "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        while true; do
            ask_input "Enter email for SSL certificate notifications" "" "ssl_email"
            if [[ -n "${ssl_email}" ]] && is_valid_email "${ssl_email}"; then
                break
            else
                echo "Please enter a valid email address."
            fi
        done
    fi
    
    save_config "ssl_email" "${ssl_email}"
    
    log_info "Obtaining SSL certificate for ${domain}..."
    
    # Check if certificate already exists
    if [[ -d "/etc/letsencrypt/live/${domain}" ]]; then
        log_info "Certificate already exists for ${domain}"
        
        # Check if it's valid
        if run_sudo certbot certificates 2>/dev/null | grep -q "${domain}"; then
            log_success "Valid certificate found"
            return 0
        fi
    fi
    
    # Obtain certificate using standalone mode
    local certbot_args=(
        "certonly"
        "--standalone"
        "-d" "${domain}"
        "--email" "${ssl_email}"
        "--agree-tos"
        "--non-interactive"
    )
    
    # Add www subdomain if user wants
    if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        if ask_yes_no "Also obtain certificate for www.${domain}?"; then
            certbot_args+=("-d" "www.${domain}")
        fi
    fi
    
    # Run Certbot
    if run_sudo certbot "${certbot_args[@]}"; then
        log_success "SSL certificate obtained successfully"
    else
        log_error "Failed to obtain SSL certificate"
        log_warning "Make sure your domain DNS points to this server's IP address"
        log_warning "You can run this step again after fixing DNS"
        return 1
    fi
}

do_verify_certificate() {
    local domain
    domain=$(get_config "domain" "")
    
    log_info "Verifying SSL certificate..."
    
    # Check certificate exists
    local cert_path="/etc/letsencrypt/live/${domain}/fullchain.pem"
    local key_path="/etc/letsencrypt/live/${domain}/privkey.pem"
    
    if [[ ! -f "${cert_path}" ]]; then
        log_error "Certificate file not found: ${cert_path}"
        return 1
    fi
    
    if [[ ! -f "${key_path}" ]]; then
        log_error "Private key not found: ${key_path}"
        return 1
    fi
    
    # Save paths to state
    save_config "ssl_cert_path" "${cert_path}"
    save_config "ssl_key_path" "${key_path}"
    
    # Check expiry
    local expiry
    expiry=$(run_sudo openssl x509 -enddate -noout -in "${cert_path}" 2>/dev/null | cut -d= -f2)
    log_info "Certificate expires: ${expiry}"
    
    log_success "SSL certificate verified"
}

do_setup_auto_renewal() {
    local domain
    domain=$(get_config "domain" "")
    
    log_info "Setting up automatic certificate renewal..."
    
    # Test renewal
    log_info "Testing renewal process..."
    if run_sudo certbot renew --dry-run; then
        log_success "Renewal test passed"
    else
        log_warning "Renewal test failed. Auto-renewal may not work correctly."
    fi
    
    # Check if systemd timer is active
    if systemctl is-active --quiet certbot.timer 2>/dev/null; then
        log_info "Certbot timer is active"
    else
        log_info "Enabling Certbot timer..."
        run_sudo systemctl enable certbot.timer
        run_sudo systemctl start certbot.timer
    fi
    
    log_success "Automatic renewal configured"
}

do_create_renewal_hook() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_info "Creating renewal hook for nginx restart..."
    
    # Create post-renewal hook
    local hook_dir="/etc/letsencrypt/renewal-hooks/post"
    run_sudo mkdir -p "${hook_dir}"
    
    run_sudo tee "${hook_dir}/restart-bires-nginx.sh" > /dev/null << EOF
#!/bin/bash
# Restart B-IRES nginx container after certificate renewal

cd "${project_dir}"
docker compose restart nginx 2>/dev/null || true
EOF
    
    run_sudo chmod +x "${hook_dir}/restart-bires-nginx.sh"
    
    log_success "Renewal hook created"
}

do_skip_ssl() {
    log_warning "SSL setup skipped. The application will use HTTP only."
    log_warning "This is NOT recommended for production use!"
    
    # Mark as using test mode
    save_config "ssl_enabled" "false"
    
    return 0
}

# =============================================================================
# Main Module Execution
# =============================================================================

run_module() {
    log_step "${MODULE_NUMBER}" "${MODULE_TITLE}"
    
    if ! should_run; then
        return 0
    fi
    
    # Check if domain is configured
    local domain
    domain=$(get_config "domain" "")
    
    if [[ -z "${domain}" ]]; then
        log_warning "Domain not configured. SSL setup requires a domain."
        
        if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
            if ask_yes_no "Skip SSL setup and use HTTP only?"; then
                do_skip_ssl
                mark_step_skipped "${MODULE_NAME}"
                return 0
            else
                log_error "Domain is required for SSL setup"
                return 1
            fi
        else
            log_error "Domain is required for SSL setup in non-interactive mode"
            return 1
        fi
    fi
    
    # Show description and ask for confirmation
    if ! ask_step_action "${MODULE_TITLE}" "$(get_description)"; then
        case $? in
            1) 
                do_skip_ssl
                mark_step_skipped "${MODULE_NAME}"
                return 0 
                ;;
            2) return 2 ;;
        esac
    fi
    
    mark_step_started "${MODULE_NAME}"
    
    # Execute steps
    local steps=(
        "do_install_certbot:Installing Certbot"
        "do_stop_services_on_80:Stopping services on port 80"
        "do_obtain_certificate:Obtaining SSL certificate"
        "do_verify_certificate:Verifying certificate"
        "do_setup_auto_renewal:Setting up auto-renewal"
        "do_create_renewal_hook:Creating renewal hook"
    )
    
    for step in "${steps[@]}"; do
        local func="${step%%:*}"
        local desc="${step#*:}"
        
        log_info "${desc}..."
        
        if ! ${func}; then
            log_error "Failed: ${desc}"
            
            # Ask if user wants to skip SSL
            if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
                if ask_yes_no "SSL setup failed. Continue without SSL (HTTP only)?"; then
                    do_skip_ssl
                    mark_step_skipped "${MODULE_NAME}"
                    return 0
                fi
            fi
            
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
    done
    
    # Mark SSL as enabled
    save_config "ssl_enabled" "true"
    
    mark_step_completed "${MODULE_NAME}"
    
    log_success "SSL certificate setup completed!"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
