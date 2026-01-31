#!/bin/bash
# =============================================================================
# B-IRES Installer - State Manager
# =============================================================================
# Manages installation state persistence for resume capability.
# State is stored as JSON in /var/lib/bires/.install-state
# =============================================================================

# Prevent multiple inclusion
[[ -n "${BIRES_STATE_MANAGER_LOADED}" ]] && return 0
readonly BIRES_STATE_MANAGER_LOADED="true"

# State file location
readonly STATE_FILE="${BIRES_STATE_DIR:-/var/lib/bires}/.install-state"
readonly STATE_LOCK="${STATE_FILE}.lock"

# =============================================================================
# State File Operations
# =============================================================================

# Initialize state file if it doesn't exist
init_state() {
    local state_dir
    state_dir=$(dirname "${STATE_FILE}")
    
    mkdir -p "${state_dir}"
    chmod 700 "${state_dir}"
    
    if [[ ! -f "${STATE_FILE}" ]]; then
        cat > "${STATE_FILE}" << 'EOF'
{
    "version": "1.0.0",
    "started_at": "",
    "updated_at": "",
    "completed": false,
    "current_step": 0,
    "steps": {
        "security_setup": {"status": "pending", "completed_at": ""},
        "docker_setup": {"status": "pending", "completed_at": ""},
        "clone_project": {"status": "pending", "completed_at": ""},
        "configure_env": {"status": "pending", "completed_at": ""},
        "ssl_setup": {"status": "pending", "completed_at": ""},
        "nginx_config": {"status": "pending", "completed_at": ""},
        "deploy_app": {"status": "pending", "completed_at": ""},
        "admin_user": {"status": "pending", "completed_at": ""},
        "firewall_setup": {"status": "pending", "completed_at": ""},
        "netdata_setup": {"status": "pending", "completed_at": ""}
    },
    "config": {},
    "credentials": {},
    "system_info": {}
}
EOF
        chmod 600 "${STATE_FILE}"
        
        # Set started_at
        state_set ".started_at" "$(date -Iseconds)"
    fi
}

# Acquire lock for state file operations
acquire_lock() {
    local max_wait=10
    local count=0
    
    while [[ -f "${STATE_LOCK}" ]]; do
        sleep 0.5
        count=$((count + 1))
        if [[ $count -ge $((max_wait * 2)) ]]; then
            rm -f "${STATE_LOCK}"
            break
        fi
    done
    
    echo $$ > "${STATE_LOCK}"
}

# Release lock
release_lock() {
    rm -f "${STATE_LOCK}"
}

# =============================================================================
# JSON Operations (using pure bash for compatibility)
# =============================================================================

# Get value from state using jq if available, otherwise use grep/sed
state_get() {
    local path="$1"
    local default="$2"
    
    if ! [[ -f "${STATE_FILE}" ]]; then
        echo "${default}"
        return
    fi
    
    if command -v jq &> /dev/null; then
        local value
        value=$(jq -r "${path} // empty" "${STATE_FILE}" 2>/dev/null)
        echo "${value:-$default}"
    else
        # Fallback for systems without jq
        # This is limited but handles simple cases
        local key
        key=$(echo "${path}" | sed 's/^\.//' | sed 's/\./_/g')
        grep -oP "\"${key}\"\s*:\s*\"\K[^\"]*" "${STATE_FILE}" 2>/dev/null || echo "${default}"
    fi
}

# Set value in state
state_set() {
    local path="$1"
    local value="$2"
    
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        
        # Update the value and updated_at timestamp
        jq "${path} = \"${value}\" | .updated_at = \"$(date -Iseconds)\"" \
            "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    else
        # Fallback: simple key-value storage in a separate file
        local simple_state="${STATE_FILE}.simple"
        local key
        key=$(echo "${path}" | sed 's/^\.//' | sed 's/\./_/g')
        
        # Remove existing key if present
        if [[ -f "${simple_state}" ]]; then
            grep -v "^${key}=" "${simple_state}" > "${simple_state}.tmp" 2>/dev/null || true
            mv "${simple_state}.tmp" "${simple_state}"
        fi
        
        # Add new key-value
        echo "${key}=${value}" >> "${simple_state}"
    fi
    
    release_lock
}

# Set nested object value
state_set_object() {
    local path="$1"
    local json_value="$2"
    
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        
        jq "${path} = ${json_value} | .updated_at = \"$(date -Iseconds)\"" \
            "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    fi
    
    release_lock
}

# =============================================================================
# Step Status Management
# =============================================================================

# Step names array (ordered)
readonly STEP_NAMES=(
    "security_setup"
    "docker_setup"
    "clone_project"
    "configure_env"
    "ssl_setup"
    "nginx_config"
    "deploy_app"
    "admin_user"
    "firewall_setup"
    "netdata_setup"
)

# Get step status
get_step_status() {
    local step_name="$1"
    state_get ".steps.${step_name}.status" "pending"
}

# Set step status
set_step_status() {
    local step_name="$1"
    local status="$2"  # pending, in_progress, completed, skipped, failed
    
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        local timestamp
        timestamp=$(date -Iseconds)
        
        jq ".steps.${step_name}.status = \"${status}\" | \
            .steps.${step_name}.completed_at = \"${timestamp}\" | \
            .updated_at = \"${timestamp}\"" \
            "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    fi
    
    release_lock
}

# Mark step as started
mark_step_started() {
    local step_name="$1"
    set_step_status "${step_name}" "in_progress"
    log_to_file "STATE" "Step ${step_name} started"
}

# Mark step as completed
mark_step_completed() {
    local step_name="$1"
    set_step_status "${step_name}" "completed"
    log_to_file "STATE" "Step ${step_name} completed"
}

# Mark step as skipped
mark_step_skipped() {
    local step_name="$1"
    set_step_status "${step_name}" "skipped"
    log_to_file "STATE" "Step ${step_name} skipped"
}

# Mark step as failed
mark_step_failed() {
    local step_name="$1"
    set_step_status "${step_name}" "failed"
    log_to_file "STATE" "Step ${step_name} failed"
}

# Mark step as pending (reset to initial state)
mark_step_pending() {
    local step_name="$1"
    set_step_status "${step_name}" "pending"
    log_to_file "STATE" "Step ${step_name} reset to pending"
}

# Check if step is completed or skipped
is_step_done() {
    local step_name="$1"
    local status
    status=$(get_step_status "${step_name}")
    [[ "${status}" == "completed" || "${status}" == "skipped" ]]
}

# Get current step number (1-based)
get_current_step_number() {
    local count=0
    for step in "${STEP_NAMES[@]}"; do
        count=$((count + 1))
        if ! is_step_done "${step}"; then
            echo "${count}"
            return
        fi
    done
    echo "${#STEP_NAMES[@]}"
}

# Get completed steps count
get_completed_steps_count() {
    local count=0
    for step in "${STEP_NAMES[@]}"; do
        if is_step_done "${step}"; then
            count=$((count + 1))
        fi
    done
    echo "${count}"
}

# Get total steps count
get_total_steps_count() {
    echo "${#STEP_NAMES[@]}"
}

# =============================================================================
# Configuration Storage
# =============================================================================

# Save configuration value
save_config() {
    local key="$1"
    local value="$2"
    
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        
        jq ".config.${key} = \"${value}\" | .updated_at = \"$(date -Iseconds)\"" \
            "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    fi
    
    release_lock
}

# Get configuration value
get_config() {
    local key="$1"
    local default="$2"
    state_get ".config.${key}" "${default}"
}

# =============================================================================
# Credentials Storage (sensitive data)
# =============================================================================

# Save credential (stored securely)
save_credential() {
    local key="$1"
    local value="$2"
    
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        
        jq ".credentials.${key} = \"${value}\" | .updated_at = \"$(date -Iseconds)\"" \
            "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    fi
    
    release_lock
}

# Get credential
get_credential() {
    local key="$1"
    state_get ".credentials.${key}" ""
}

# =============================================================================
# System Info Storage
# =============================================================================

# Save system info
save_system_info() {
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        local ip_address
        ip_address=$(get_ip_address 2>/dev/null || echo "unknown")
        
        jq ".system_info = {
            \"hostname\": \"$(hostname)\",
            \"ip_address\": \"${ip_address}\",
            \"os_name\": \"$(. /etc/os-release && echo ${ID})\",
            \"os_version\": \"$(. /etc/os-release && echo ${VERSION_ID})\",
            \"total_memory_kb\": $(grep MemTotal /proc/meminfo | awk '{print $2}'),
            \"cpu_cores\": $(nproc),
            \"install_user\": \"$(whoami)\"
        } | .updated_at = \"$(date -Iseconds)\"" \
            "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    fi
    
    release_lock
}

# =============================================================================
# Resume Detection
# =============================================================================

# Check if there's a previous installation to resume
has_previous_state() {
    [[ -f "${STATE_FILE}" ]] && \
    [[ "$(get_completed_steps_count)" -gt 0 ]]
}

# Check if installation is complete
is_installation_complete() {
    [[ "$(state_get '.completed' 'false')" == "true" ]]
}

# Mark installation as complete
mark_installation_complete() {
    state_set ".completed" "true"
}

# Reset state (start fresh)
reset_state() {
    rm -f "${STATE_FILE}" "${STATE_LOCK}"
    init_state
}

# Reset from a specific step onwards
reset_from_step() {
    local start_index="$1"
    
    acquire_lock
    
    if command -v jq &> /dev/null; then
        local tmp_file
        tmp_file=$(mktemp)
        local timestamp
        timestamp=$(date -Iseconds)
        
        # Build jq command to reset steps
        local jq_cmd=".updated_at = \"${timestamp}\""
        
        local i=0
        for step in "${STEP_NAMES[@]}"; do
            if [[ $i -ge $start_index ]]; then
                jq_cmd+=" | .steps.${step}.status = \"pending\" | .steps.${step}.completed_at = \"\""
            fi
            ((i++))
        done
        
        jq "${jq_cmd}" "${STATE_FILE}" > "${tmp_file}" 2>/dev/null
        
        if [[ -s "${tmp_file}" ]]; then
            mv "${tmp_file}" "${STATE_FILE}"
            chmod 600 "${STATE_FILE}"
        else
            rm -f "${tmp_file}"
        fi
    fi
    
    release_lock
    
    log_to_file "STATE" "Reset steps from index ${start_index}"
}

# Display resume prompt
prompt_resume() {
    if has_previous_state && ! is_installation_complete; then
        local completed
        completed=$(get_completed_steps_count)
        local total
        total=$(get_total_steps_count)
        
        echo ""
        print_box "Previous Installation Detected" \
            "Found incomplete installation (${completed}/${total} steps done)." \
            "" \
            "You can resume from where you left off or start fresh."
        echo ""
        
        if ask_yes_no "Resume previous installation?"; then
            return 0  # Resume
        else
            if ask_yes_no "Start fresh? (This will delete previous progress)"; then
                reset_state
            fi
        fi
    fi
    return 1  # Don't resume / no previous state
}

# =============================================================================
# Export Credentials
# =============================================================================

# Export credentials to a readable file for the user
export_credentials_file() {
    local target_file="${1:-/home/${BIRES_USER:-bires}/bires-credentials.txt}"
    local target_dir
    target_dir=$(dirname "${target_file}")
    
    mkdir -p "${target_dir}"
    
    cat > "${target_file}" << EOF
# =============================================================================
# B-IRES Platform Credentials
# Generated: $(date)
# =============================================================================
# KEEP THIS FILE SECURE! Delete after noting down the credentials.
# =============================================================================

# Admin Dashboard Login
ADMIN_EMAIL=$(get_config "admin_email" "admin@example.com")
ADMIN_PASSWORD=$(get_credential "admin_password" "[auto-generated]")

# Domain
DOMAIN=$(get_config "domain" "[not configured]")

# Database Credentials
MONGO_USER=$(get_config "mongo_user" "bires_admin")
MONGO_PASSWORD=$(get_credential "mongo_password" "[auto-generated]")

# Redis
REDIS_PASSWORD=$(get_credential "redis_password" "[auto-generated]")

# MinIO (Object Storage)
MINIO_ACCESS_KEY=$(get_config "minio_access_key" "bires_minio_admin")
MINIO_SECRET_KEY=$(get_credential "minio_secret_key" "[auto-generated]")

# JWT Secret (for API authentication)
JWT_SECRET=$(get_credential "jwt_secret" "[auto-generated]")

# =============================================================================
# URLs
# =============================================================================
MAIN_APP_URL=https://$(get_config "domain" "yourdomain.com")
ADMIN_PANEL_URL=https://$(get_config "domain" "yourdomain.com")/admin
API_URL=https://$(get_config "domain" "yourdomain.com")/api
NETDATA_URL=http://$(get_config "ip_address" "YOUR_IP"):19999

# =============================================================================
# Important Commands
# =============================================================================
# Start services:   bash ~/bires/scripts/start-prod.sh
# Stop services:    bash ~/bires/scripts/stop-prod.sh
# Restart services: bash ~/bires/scripts/restart-prod.sh
# View logs:        docker compose logs -f
# =============================================================================
EOF
    
    chmod 600 "${target_file}"
    
    # Change ownership if running as root
    if [[ -n "${BIRES_USER}" ]] && id "${BIRES_USER}" &>/dev/null; then
        chown "${BIRES_USER}:${BIRES_USER}" "${target_file}"
    fi
    
    echo "${target_file}"
}

# =============================================================================
# Initialize
# =============================================================================

# Auto-initialize state if sourced
init_state
