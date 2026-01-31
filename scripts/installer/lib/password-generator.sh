#!/bin/bash
# =============================================================================
# B-IRES Installer - Password Generator
# =============================================================================
# Generates secure random passwords for all system components.
# Uses openssl for cryptographically secure random generation.
# =============================================================================

# Prevent multiple inclusion
[[ -n "${BIRES_PASSWORD_GEN_LOADED}" ]] && return 0
readonly BIRES_PASSWORD_GEN_LOADED="true"

# =============================================================================
# Password Generation Functions
# =============================================================================

# Generate random hex string
# Usage: generate_hex_string 32  # Generates 64 character hex string
generate_hex_string() {
    local bytes="${1:-32}"
    
    if command -v openssl &> /dev/null; then
        openssl rand -hex "${bytes}"
    elif [[ -f /dev/urandom ]]; then
        head -c "${bytes}" /dev/urandom | xxd -p | tr -d '\n'
    else
        # Fallback using $RANDOM (less secure but works everywhere)
        local result=""
        for ((i=0; i<bytes*2; i++)); do
            result+=$(printf '%x' $((RANDOM % 16)))
        done
        echo "${result}"
    fi
}

# Generate random alphanumeric string
# Usage: generate_alphanumeric 32
generate_alphanumeric() {
    local length="${1:-32}"
    
    if command -v openssl &> /dev/null; then
        openssl rand -base64 $((length * 2)) | tr -dc 'a-zA-Z0-9' | head -c "${length}"
    elif [[ -f /dev/urandom ]]; then
        tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c "${length}"
    else
        # Fallback
        local chars='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
        local result=""
        for ((i=0; i<length; i++)); do
            result+="${chars:RANDOM%${#chars}:1}"
        done
        echo "${result}"
    fi
}

# Generate password with special characters
# Usage: generate_password 32
generate_password() {
    local length="${1:-32}"
    
    if command -v openssl &> /dev/null; then
        # Generate with letters, numbers, and limited special chars (safe for most configs)
        openssl rand -base64 $((length * 2)) | tr -dc 'a-zA-Z0-9!@#$%^&*()_+-=' | head -c "${length}"
    else
        generate_alphanumeric "${length}"
    fi
}

# =============================================================================
# Specific Password Generators
# =============================================================================

# Generate JWT secret (64 characters hex)
generate_jwt_secret() {
    generate_hex_string 32  # 32 bytes = 64 hex characters
}

# Generate MongoDB password (32 characters alphanumeric)
generate_mongo_password() {
    generate_alphanumeric 32
}

# Generate Redis password (32 characters alphanumeric)
generate_redis_password() {
    generate_alphanumeric 32
}

# Generate MinIO secret key (32 characters alphanumeric)
generate_minio_secret_key() {
    generate_alphanumeric 32
}

# Generate admin password (16 characters with special chars)
generate_admin_password() {
    generate_password 16
}

# =============================================================================
# Password Management
# =============================================================================

# Generate all required passwords and store in state
generate_all_passwords() {
    log_info "Generating secure passwords..."
    
    local jwt_secret
    local mongo_admin_password
    local mongo_password
    local redis_password
    local minio_secret_key
    local admin_password
    
    # Check if we should auto-generate or use provided values
    local auto_generate
    auto_generate=$(config_get "AUTO_GENERATE_PASSWORDS" "yes")
    auto_generate=$(echo "${auto_generate}" | tr '[:upper:]' '[:lower:]')
    
    # JWT Secret
    jwt_secret=$(config_get "JWT_SECRET" "")
    if [[ -z "${jwt_secret}" ]]; then
        jwt_secret=$(generate_jwt_secret)
        log_debug "Generated JWT_SECRET"
    fi
    save_credential "jwt_secret" "${jwt_secret}"
    
    # MongoDB Admin Password (for root user)
    mongo_admin_password=$(config_get "MONGO_ADMIN_PASSWORD" "")
    if [[ -z "${mongo_admin_password}" ]]; then
        mongo_admin_password=$(generate_mongo_password)
        log_debug "Generated MONGO_ADMIN_PASSWORD"
    fi
    save_credential "mongo_admin_password" "${mongo_admin_password}"
    
    # MongoDB Password (for application user)
    mongo_password=$(config_get "MONGO_PASSWORD" "")
    if [[ -z "${mongo_password}" ]]; then
        mongo_password=$(generate_mongo_password)
        log_debug "Generated MONGO_PASSWORD"
    fi
    save_credential "mongo_password" "${mongo_password}"
    
    # Redis Password
    redis_password=$(config_get "REDIS_PASSWORD" "")
    if [[ -z "${redis_password}" ]]; then
        redis_password=$(generate_redis_password)
        log_debug "Generated REDIS_PASSWORD"
    fi
    save_credential "redis_password" "${redis_password}"
    
    # MinIO Secret Key
    minio_secret_key=$(config_get "MINIO_SECRET_KEY" "")
    if [[ -z "${minio_secret_key}" ]]; then
        minio_secret_key=$(generate_minio_secret_key)
        log_debug "Generated MINIO_SECRET_KEY"
    fi
    save_credential "minio_secret_key" "${minio_secret_key}"
    
    # Admin Password
    admin_password=$(config_get "ADMIN_PASSWORD" "")
    if [[ -z "${admin_password}" ]]; then
        admin_password=$(generate_admin_password)
        log_debug "Generated ADMIN_PASSWORD"
    fi
    save_credential "admin_password" "${admin_password}"
    
    log_success "All passwords generated and stored securely"
}

# Get or generate a specific credential
# Usage: get_or_generate_credential "jwt_secret" "generate_jwt_secret"
get_or_generate_credential() {
    local key="$1"
    local generator="$2"
    
    # First check if already stored in state
    local stored_value
    stored_value=$(get_credential "${key}" "")
    
    if [[ -n "${stored_value}" ]]; then
        echo "${stored_value}"
        return
    fi
    
    # Check config file
    local config_key
    config_key=$(echo "${key}" | tr '[:lower:]' '[:upper:]')
    local config_value
    config_value=$(config_get "${config_key}" "")
    
    if [[ -n "${config_value}" ]]; then
        save_credential "${key}" "${config_value}"
        echo "${config_value}"
        return
    fi
    
    # Generate new value
    local new_value
    new_value=$("${generator}")
    save_credential "${key}" "${new_value}"
    echo "${new_value}"
}

# =============================================================================
# Password Prompt Functions
# =============================================================================

# Prompt for password generation
prompt_password_generation() {
    if [[ "${BIRES_NON_INTERACTIVE:-false}" == "true" ]]; then
        generate_all_passwords
        return 0
    fi
    
    echo ""
    print_box "Password Configuration" \
        "The following passwords are required:" \
        "" \
        "  - JWT Secret (API authentication)" \
        "  - MongoDB Password" \
        "  - Redis Password" \
        "  - MinIO Secret Key" \
        "  - Admin User Password"
    echo ""
    
    if ask_yes_no "Generate strong random passwords automatically?"; then
        config_set "AUTO_GENERATE_PASSWORDS" "yes"
        generate_all_passwords
    else
        config_set "AUTO_GENERATE_PASSWORDS" "no"
        prompt_manual_passwords
    fi
}

# Prompt for manual password entry
prompt_manual_passwords() {
    log_info "Please enter passwords manually..."
    echo ""
    
    # JWT Secret
    local jwt_secret
    ask_input "JWT Secret (64 chars, or press Enter to auto-generate)" "" "jwt_secret"
    if [[ -z "${jwt_secret}" ]]; then
        jwt_secret=$(generate_jwt_secret)
        log_info "Auto-generated JWT Secret"
    fi
    save_credential "jwt_secret" "${jwt_secret}"
    
    # MongoDB Password
    local mongo_password
    ask_password "MongoDB Password" "mongo_password" false
    if [[ -z "${mongo_password}" ]]; then
        mongo_password=$(generate_mongo_password)
        log_info "Auto-generated MongoDB Password"
    fi
    save_credential "mongo_password" "${mongo_password}"
    
    # Redis Password
    local redis_password
    ask_password "Redis Password" "redis_password" false
    if [[ -z "${redis_password}" ]]; then
        redis_password=$(generate_redis_password)
        log_info "Auto-generated Redis Password"
    fi
    save_credential "redis_password" "${redis_password}"
    
    # MinIO Secret Key
    local minio_secret_key
    ask_password "MinIO Secret Key" "minio_secret_key" false
    if [[ -z "${minio_secret_key}" ]]; then
        minio_secret_key=$(generate_minio_secret_key)
        log_info "Auto-generated MinIO Secret Key"
    fi
    save_credential "minio_secret_key" "${minio_secret_key}"
    
    # Admin Password
    local admin_password
    echo ""
    log_info "Set password for B-IRES admin user:"
    ask_password "Admin Password" "admin_password" true
    if [[ -z "${admin_password}" ]]; then
        admin_password=$(generate_admin_password)
        log_info "Auto-generated Admin Password"
    fi
    save_credential "admin_password" "${admin_password}"
    
    log_success "All passwords configured"
}

# =============================================================================
# Password Strength Validation
# =============================================================================

# Check password strength
# Returns: 0 = strong, 1 = medium, 2 = weak
check_password_strength() {
    local password="$1"
    local length=${#password}
    local score=0
    
    # Length check
    [[ $length -ge 8 ]] && ((score++))
    [[ $length -ge 12 ]] && ((score++))
    [[ $length -ge 16 ]] && ((score++))
    
    # Character class checks
    [[ "${password}" =~ [a-z] ]] && ((score++))
    [[ "${password}" =~ [A-Z] ]] && ((score++))
    [[ "${password}" =~ [0-9] ]] && ((score++))
    [[ "${password}" =~ [^a-zA-Z0-9] ]] && ((score++))
    
    if [[ $score -ge 6 ]]; then
        return 0  # Strong
    elif [[ $score -ge 4 ]]; then
        return 1  # Medium
    else
        return 2  # Weak
    fi
}

# Display password strength
display_password_strength() {
    local password="$1"
    local label="${2:-Password}"
    
    check_password_strength "${password}"
    local strength=$?
    
    case $strength in
        0)
            echo -e "${COLOR_GREEN}${label} strength: Strong${COLOR_NC}"
            ;;
        1)
            echo -e "${COLOR_YELLOW}${label} strength: Medium${COLOR_NC}"
            ;;
        2)
            echo -e "${COLOR_RED}${label} strength: Weak${COLOR_NC}"
            ;;
    esac
    
    return $strength
}

# =============================================================================
# Password Display (for confirmation)
# =============================================================================

# Display generated passwords (masked by default)
display_passwords_summary() {
    local show_passwords="${1:-false}"
    
    echo ""
    echo -e "${FORMAT_BOLD}Generated Credentials Summary:${FORMAT_RESET}"
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
    
    local jwt_secret mongo_admin_password mongo_password redis_password minio_secret_key admin_password
    jwt_secret=$(get_credential "jwt_secret" "")
    mongo_admin_password=$(get_credential "mongo_admin_password" "")
    mongo_password=$(get_credential "mongo_password" "")
    redis_password=$(get_credential "redis_password" "")
    minio_secret_key=$(get_credential "minio_secret_key" "")
    admin_password=$(get_credential "admin_password" "")
    
    if [[ "${show_passwords}" == "true" ]]; then
        echo "  JWT Secret:            ${jwt_secret:0:20}..."
        echo "  MongoDB Root Password: ${mongo_admin_password}"
        echo "  MongoDB User Password: ${mongo_password}"
        echo "  Redis Password:        ${redis_password}"
        echo "  MinIO Secret Key:      ${minio_secret_key}"
        echo "  Admin Password:        ${admin_password}"
    else
        echo "  JWT Secret:            ****...****"
        echo "  MongoDB Root Password: ********************************"
        echo "  MongoDB User Password: ********************************"
        echo "  Redis Password:        ********************************"
        echo "  MinIO Secret Key:      ********************************"
        echo "  Admin Password:        ****************"
    fi
    
    echo ""
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
    
    if [[ "${show_passwords}" != "true" ]]; then
        echo -e "${COLOR_YELLOW}Note: Passwords will be saved to ~/bires-credentials.txt${COLOR_NC}"
    fi
}
