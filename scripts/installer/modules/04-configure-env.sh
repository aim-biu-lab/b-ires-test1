#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 04: Configure Environment
# =============================================================================
# Generates the .env file with all required configuration values and
# generated passwords.
# =============================================================================

# Module info
MODULE_NAME="configure_env"
MODULE_TITLE="Configure Environment Variables"
MODULE_NUMBER=4

# Source common functions
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/state-manager.sh"
source "${SCRIPT_DIR}/lib/config-parser.sh"
source "${SCRIPT_DIR}/lib/password-generator.sh"

# =============================================================================
# Module Functions
# =============================================================================

should_run() {
    if is_step_done "${MODULE_NAME}"; then
        log_info "Environment configuration already completed"
        return 1
    fi
    return 0
}

get_description() {
    cat << EOF
  - Generate secure passwords for all services
  - Create production .env file with:
    - JWT secret for API authentication
    - MongoDB credentials
    - Redis password
    - MinIO credentials
    - Domain and URL configuration
  - Set correct file permissions
EOF
}

# =============================================================================
# Configuration Functions
# =============================================================================

do_collect_configuration() {
    log_info "Collecting configuration values..."
    
    # Domain
    local domain
    domain=$(config_get "DOMAIN" "")
    if [[ -z "${domain}" && "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        echo ""
        while true; do
            ask_input "Enter your domain name (e.g., bires-study.com)" "" "domain"
            if [[ -n "${domain}" ]]; then
                if is_valid_domain "${domain}"; then
                    break
                else
                    echo "Invalid domain format. Please try again."
                fi
            else
                echo "Domain name is required."
            fi
        done
    fi
    save_config "domain" "${domain}"
    config_set "DOMAIN" "${domain}"
    
    # Admin email
    local admin_email
    admin_email=$(config_get "ADMIN_EMAIL" "")
    if [[ -z "${admin_email}" && "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        while true; do
            ask_input "Enter admin email address" "" "admin_email"
            if [[ -n "${admin_email}" ]]; then
                if is_valid_email "${admin_email}"; then
                    break
                else
                    echo "Invalid email format. Please try again."
                fi
            else
                echo "Admin email is required."
            fi
        done
    fi
    save_config "admin_email" "${admin_email}"
    config_set "ADMIN_EMAIL" "${admin_email}"
    
    # Admin username
    local admin_username
    admin_username=$(config_get "ADMIN_USERNAME" "admin")
    if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        ask_input "Enter admin username" "${admin_username}" "admin_username"
    fi
    save_config "admin_username" "${admin_username}"
    config_set "ADMIN_USERNAME" "${admin_username}"
    
    # MongoDB username
    local mongo_user
    mongo_user=$(config_get "MONGO_USER" "bires_admin")
    save_config "mongo_user" "${mongo_user}"
    
    # MinIO access key
    local minio_access_key
    minio_access_key=$(config_get "MINIO_ACCESS_KEY" "bires_minio_admin")
    save_config "minio_access_key" "${minio_access_key}"
    
    log_success "Configuration values collected"
}

do_generate_passwords() {
    log_info "Generating secure passwords..."
    
    # Prompt for password generation preference
    prompt_password_generation
    
    log_success "Passwords generated"
}

do_create_env_file() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    if [[ -z "${project_dir}" ]]; then
        local username
        username=$(get_config "create_user" "bires")
        project_dir="/home/${username}/bires"
    fi
    
    local env_file="${project_dir}/.env"
    
    log_info "Creating production .env file..."
    
    # Backup existing .env if present
    if [[ -f "${env_file}" ]]; then
        backup_file "${env_file}"
    fi
    
    # Get all values
    local domain
    domain=$(get_config "domain" "yourdomain.com")
    local admin_email
    admin_email=$(get_config "admin_email" "admin@example.com")
    
    local jwt_secret
    jwt_secret=$(get_credential "jwt_secret" "")
    local mongo_admin_password
    mongo_admin_password=$(get_credential "mongo_admin_password" "")
    local mongo_password
    mongo_password=$(get_credential "mongo_password" "")
    local redis_password
    redis_password=$(get_credential "redis_password" "")
    local minio_secret_key
    minio_secret_key=$(get_credential "minio_secret_key" "")
    
    local mongo_user
    mongo_user=$(get_config "mongo_user" "bires_admin")
    local minio_access_key
    minio_access_key=$(get_config "minio_access_key" "bires_minio_admin")
    
    # Create .env file
    run_sudo tee "${env_file}" > /dev/null << EOF
# =============================================================================
# B-IRES Platform - Production Environment Configuration
# Generated: $(date)
# =============================================================================

# ======================
# Security (REQUIRED)
# ======================
JWT_SECRET=${jwt_secret}
JWT_ALGORITHM=HS256
JWT_EXPIRATION_HOURS=24

# ======================
# MongoDB
# ======================
MONGO_URL=mongodb://${mongo_user}:${mongo_password}@mongo:27017/bires?authSource=admin
MONGO_DB=bires
MONGO_ADMIN_PASSWORD=${mongo_admin_password}
MONGO_USER=${mongo_user}
MONGO_PASSWORD=${mongo_password}

# ======================
# Redis
# ======================
REDIS_URL=redis://:${redis_password}@redis:6379
REDIS_PASSWORD=${redis_password}

# ======================
# MinIO / S3
# ======================
MINIO_ENDPOINT=minio:9000
MINIO_ACCESS_KEY=${minio_access_key}
MINIO_SECRET_KEY=${minio_secret_key}
MINIO_BUCKET=bires-assets
MINIO_SECURE=false

# ======================
# Application
# ======================
ENVIRONMENT=production
DEBUG=false
API_URL=https://${domain}/api
FRONTEND_URL=https://${domain}
ADMIN_URL=https://${domain}/admin

# ======================
# Email (Optional)
# ======================
# Uncomment and configure if email notifications are needed
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=noreply@${domain}
# SMTP_PASSWORD=email_password
# SMTP_FROM=B-IRES Platform <noreply@${domain}>

# ======================
# SSL/TLS (Production)
# ======================
SSL_CERT_PATH=/etc/letsencrypt/live/${domain}/fullchain.pem
SSL_KEY_PATH=/etc/letsencrypt/live/${domain}/privkey.pem
EOF
    
    # Set secure permissions
    run_sudo chmod 600 "${env_file}"
    
    # Set ownership
    local username
    username=$(get_config "create_user" "bires")
    run_sudo chown "${username}:${username}" "${env_file}"
    
    log_success "Production .env file created"
}

do_create_env_local() {
    # Create a local development .env.local if needed (optional)
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    if [[ -z "${project_dir}" ]]; then
        return 0
    fi
    
    log_info "Environment files configured"
}

do_verify_env() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    local env_file="${project_dir}/.env"
    
    log_info "Verifying environment configuration..."
    
    if [[ ! -f "${env_file}" ]]; then
        log_error ".env file not found"
        return 1
    fi
    
    # Check for required variables
    local required_vars=(
        "JWT_SECRET"
        "MONGO_URL"
        "MONGO_ADMIN_PASSWORD"
        "MONGO_PASSWORD"
        "REDIS_PASSWORD"
        "MINIO_SECRET_KEY"
    )
    
    local missing=()
    for var in "${required_vars[@]}"; do
        if ! grep -q "^${var}=" "${env_file}"; then
            missing+=("${var}")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required environment variables: ${missing[*]}"
        return 1
    fi
    
    log_success "Environment configuration verified"
}

do_display_summary() {
    local domain
    domain=$(get_config "domain" "")
    
    echo ""
    print_box "Environment Configuration Summary" \
        "Domain:     ${domain}" \
        "API URL:    https://${domain}/api" \
        "Admin URL:  https://${domain}/admin" \
        "" \
        "Passwords have been securely generated and stored."
    echo ""
    
    # Display password summary
    display_passwords_summary false
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
        "do_collect_configuration:Collecting configuration"
        "do_generate_passwords:Generating passwords"
        "do_create_env_file:Creating .env file"
        "do_verify_env:Verifying environment"
        "do_display_summary:Displaying summary"
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
    
    log_success "Environment configuration completed!"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
