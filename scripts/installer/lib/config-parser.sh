#!/bin/bash
# =============================================================================
# B-IRES Installer - Configuration File Parser
# =============================================================================
# Parses configuration files for unattended installation.
# Supports INI-like format with comments and sections.
# =============================================================================

# Prevent multiple inclusion
[[ -n "${BIRES_CONFIG_PARSER_LOADED}" ]] && return 0
readonly BIRES_CONFIG_PARSER_LOADED="true"

# Configuration storage (associative array)
declare -gA CONFIG_VALUES

# =============================================================================
# Configuration File Parsing
# =============================================================================

# Parse configuration file
# Usage: parse_config_file "/path/to/config.txt"
parse_config_file() {
    local config_file="$1"
    
    if [[ ! -f "${config_file}" ]]; then
        log_error "Configuration file not found: ${config_file}"
        return 1
    fi
    
    log_info "Parsing configuration file: ${config_file}"
    
    local line_num=0
    local current_section=""
    
    while IFS= read -r line || [[ -n "${line}" ]]; do
        line_num=$((line_num + 1))
        
        # Skip empty lines
        [[ -z "${line}" ]] && continue
        
        # Skip comments
        [[ "${line}" =~ ^[[:space:]]*# ]] && continue
        
        # Remove inline comments
        line="${line%%#*}"
        
        # Trim whitespace
        line=$(echo "${line}" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
        
        # Skip if line is now empty after removing comments
        [[ -z "${line}" ]] && continue
        
        # Check for section headers [section]
        if [[ "${line}" =~ ^\[([^\]]+)\]$ ]]; then
            current_section="${BASH_REMATCH[1]}"
            continue
        fi
        
        # Parse key=value pairs
        if [[ "${line}" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            local key="${BASH_REMATCH[1]}"
            local value="${BASH_REMATCH[2]}"
            
            # Remove quotes from value if present
            value=$(echo "${value}" | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")
            
            # Store in associative array
            CONFIG_VALUES["${key}"]="${value}"
            
            log_debug "Config: ${key}=${value}"
        else
            log_warning "Invalid config line ${line_num}: ${line}"
        fi
    done < "${config_file}"
    
    log_success "Configuration file parsed successfully"
    return 0
}

# =============================================================================
# Configuration Access Functions
# =============================================================================

# Get configuration value
# Usage: config_get "KEY" "default_value"
config_get() {
    local key="$1"
    local default="$2"
    
    if [[ -v CONFIG_VALUES["${key}"] ]]; then
        echo "${CONFIG_VALUES["${key}"]}"
    else
        echo "${default}"
    fi
}

# Check if configuration key exists
# Usage: config_exists "KEY"
config_exists() {
    local key="$1"
    [[ -v CONFIG_VALUES["${key}"] ]]
}

# Check if configuration value is "yes" or "true"
# Usage: config_is_enabled "KEY"
config_is_enabled() {
    local key="$1"
    local value
    value=$(config_get "${key}" "no")
    value=$(echo "${value}" | tr '[:upper:]' '[:lower:]')
    [[ "${value}" == "yes" || "${value}" == "true" || "${value}" == "1" ]]
}

# Check if configuration value is "no" or "false"
# Usage: config_is_disabled "KEY"
config_is_disabled() {
    local key="$1"
    local value
    value=$(config_get "${key}" "yes")
    value=$(echo "${value}" | tr '[:upper:]' '[:lower:]')
    [[ "${value}" == "no" || "${value}" == "false" || "${value}" == "0" ]]
}

# Set configuration value (runtime override)
# Usage: config_set "KEY" "value"
config_set() {
    local key="$1"
    local value="$2"
    CONFIG_VALUES["${key}"]="${value}"
}

# =============================================================================
# Configuration Validation
# =============================================================================

# Validate required configuration keys for non-interactive mode
validate_required_config() {
    local required_keys=(
        "DOMAIN"
        "ADMIN_EMAIL"
    )
    
    local missing=()
    
    for key in "${required_keys[@]}"; do
        if ! config_exists "${key}" || [[ -z "$(config_get "${key}")" ]]; then
            missing+=("${key}")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required configuration values:"
        for key in "${missing[@]}"; do
            log_error "  - ${key}"
        done
        return 1
    fi
    
    return 0
}

# Validate domain format
validate_config_domain() {
    local domain
    domain=$(config_get "DOMAIN" "")
    
    if [[ -n "${domain}" ]] && ! is_valid_domain "${domain}"; then
        log_error "Invalid domain format: ${domain}"
        return 1
    fi
    
    return 0
}

# Validate email format
validate_config_email() {
    local email
    email=$(config_get "ADMIN_EMAIL" "")
    
    if [[ -n "${email}" ]] && ! is_valid_email "${email}"; then
        log_error "Invalid email format: ${email}"
        return 1
    fi
    
    return 0
}

# Validate SSL email format
validate_config_ssl_email() {
    local email
    email=$(config_get "SSL_EMAIL" "")
    
    if [[ -n "${email}" ]] && ! is_valid_email "${email}"; then
        log_error "Invalid SSL email format: ${email}"
        return 1
    fi
    
    return 0
}

# Run all validations
validate_config() {
    local errors=0
    
    validate_config_domain || ((errors++))
    validate_config_email || ((errors++))
    validate_config_ssl_email || ((errors++))
    
    return $errors
}

# =============================================================================
# Configuration Loading with State
# =============================================================================

# Load configuration from file and merge with saved state
load_config_with_state() {
    local config_file="$1"
    
    # First, load from state (previous run values)
    if command -v get_config &>/dev/null; then
        # Load stored configs into CONFIG_VALUES
        for key in domain create_user admin_email admin_username github_repo \
                   low_profile_mode setup_security setup_ssl setup_firewall \
                   install_netdata disable_root_login disable_password_auth; do
            local value
            value=$(get_config "${key}" "")
            if [[ -n "${value}" ]]; then
                CONFIG_VALUES["$(echo "${key}" | tr '[:lower:]' '[:upper:]')"]="${value}"
            fi
        done
    fi
    
    # Then, parse config file (overrides state)
    if [[ -n "${config_file}" && -f "${config_file}" ]]; then
        parse_config_file "${config_file}"
    fi
    
    return 0
}

# Save current configuration to state
save_config_to_state() {
    if ! command -v save_config &>/dev/null; then
        return 0
    fi
    
    # Save each config value to state
    for key in "${!CONFIG_VALUES[@]}"; do
        local lower_key
        lower_key=$(echo "${key}" | tr '[:upper:]' '[:lower:]')
        save_config "${lower_key}" "${CONFIG_VALUES["${key}"]}"
    done
}

# =============================================================================
# Configuration Summary
# =============================================================================

# Print configuration summary (hiding sensitive values)
print_config_summary() {
    echo ""
    echo -e "${FORMAT_BOLD}Configuration Summary:${FORMAT_RESET}"
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
    
    # Server Security
    echo -e "${FORMAT_BOLD}Server Security:${FORMAT_RESET}"
    echo "  Setup Security:     $(config_get "SETUP_SECURITY" "yes")"
    echo "  Create User:        $(config_get "CREATE_USER" "bires")"
    echo "  Disable Root Login: $(config_get "DISABLE_ROOT_LOGIN" "yes")"
    echo ""
    
    # Domain & SSL
    echo -e "${FORMAT_BOLD}Domain & SSL:${FORMAT_RESET}"
    echo "  Domain:             $(config_get "DOMAIN" "[not set]")"
    echo "  Setup SSL:          $(config_get "SETUP_SSL" "yes")"
    echo "  SSL Email:          $(config_get "SSL_EMAIL" "[not set]")"
    echo ""
    
    # Admin User
    echo -e "${FORMAT_BOLD}Admin User:${FORMAT_RESET}"
    echo "  Email:              $(config_get "ADMIN_EMAIL" "[not set]")"
    echo "  Username:           $(config_get "ADMIN_USERNAME" "admin")"
    echo ""
    
    # Deployment
    echo -e "${FORMAT_BOLD}Deployment:${FORMAT_RESET}"
    echo "  GitHub Repo:        $(config_get "GITHUB_REPO" "[default]")"
    echo "  Low Profile Mode:   $(config_get "LOW_PROFILE_MODE" "no")"
    echo "  Install Netdata:    $(config_get "INSTALL_NETDATA" "yes")"
    echo "  Setup Firewall:     $(config_get "SETUP_FIREWALL" "yes")"
    echo ""
    
    # Passwords
    echo -e "${FORMAT_BOLD}Passwords:${FORMAT_RESET}"
    echo "  Auto Generate:      $(config_get "AUTO_GENERATE_PASSWORDS" "yes")"
    
    local pwd_display="[auto-generated]"
    if ! config_is_enabled "AUTO_GENERATE_PASSWORDS"; then
        pwd_display="[provided in config]"
    fi
    
    echo "  JWT Secret:         ${pwd_display}"
    echo "  MongoDB Password:   ${pwd_display}"
    echo "  Redis Password:     ${pwd_display}"
    echo "  MinIO Secret Key:   ${pwd_display}"
    echo ""
    
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
}

# =============================================================================
# Helper Functions for Common Config Values
# =============================================================================

# Get domain from config or prompt
get_domain() {
    local domain
    domain=$(config_get "DOMAIN" "")
    
    if [[ -z "${domain}" && "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        ask_input "Enter your domain name (e.g., bires-study.com)" "" "domain"
        config_set "DOMAIN" "${domain}"
    fi
    
    echo "${domain}"
}

# Get admin email from config or prompt
get_admin_email() {
    local email
    email=$(config_get "ADMIN_EMAIL" "")
    
    if [[ -z "${email}" && "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        while true; do
            ask_input "Enter admin email address" "" "email"
            if is_valid_email "${email}"; then
                break
            else
                echo "Invalid email format. Please try again."
            fi
        done
        config_set "ADMIN_EMAIL" "${email}"
    fi
    
    echo "${email}"
}

# Get create user name from config or prompt
get_create_user() {
    local username
    username=$(config_get "CREATE_USER" "bires")
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        ask_input "Enter username for the system user" "${username}" "username"
        config_set "CREATE_USER" "${username}"
    fi
    
    echo "${username}"
}

# Get GitHub repo URL from config or default
get_github_repo() {
    local repo
    repo=$(config_get "GITHUB_REPO" "${BIRES_GITHUB_REPO:-https://github.com/YOUR_ORG/bires.git}")
    echo "${repo}"
}

# Check if low profile mode is enabled
is_low_profile_mode() {
    config_is_enabled "LOW_PROFILE_MODE" || [[ "${BIRES_LOW_PROFILE:-false}" == "true" ]]
}

# Check if SSL should be configured
should_setup_ssl() {
    ! config_is_disabled "SETUP_SSL"
}

# Check if security hardening should be done
should_setup_security() {
    ! config_is_disabled "SETUP_SECURITY"
}

# Check if firewall should be configured
should_setup_firewall() {
    ! config_is_disabled "SETUP_FIREWALL"
}

# Check if Netdata should be installed
should_install_netdata() {
    ! config_is_disabled "INSTALL_NETDATA"
}
