#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 03: Clone Project
# =============================================================================
# Clones the B-IRES repository from GitHub and sets up the project structure.
# =============================================================================

# Module info
MODULE_NAME="clone_project"
MODULE_TITLE="Clone B-IRES Project"
MODULE_NUMBER=3

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
        log_info "Project clone already completed"
        return 1
    fi
    return 0
}

get_description() {
    local repo
    repo=$(get_github_repo)
    cat << EOF
  - Clone B-IRES repository from: ${repo}
  - Set up project directory structure
  - Set correct file permissions
  - Make scripts executable
EOF
}

# =============================================================================
# Clone Functions
# =============================================================================

do_prepare_directory() {
    local username
    username=$(get_config "create_user" "bires")
    if [[ -z "${username}" ]]; then
        username=$(config_get "CREATE_USER" "bires")
    fi
    
    local project_dir="/home/${username}/bires"
    
    # Save project directory to state
    save_config "project_dir" "${project_dir}"
    export BIRES_PROJECT_DIR="${project_dir}"
    
    log_info "Preparing project directory: ${project_dir}"
    
    # Check if directory already exists
    if [[ -d "${project_dir}" ]]; then
        if [[ -d "${project_dir}/.git" ]]; then
            log_info "Project directory exists with git repository"
            
            if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
                echo ""
                echo "Options:"
                echo "  1) Update existing repository (git pull)"
                echo "  2) Remove and re-clone"
                echo "  3) Keep existing and skip"
                echo ""
                
                ask_choice "Select option:" "Update existing|Remove and re-clone|Keep existing" "clone_action" "Update existing"
                
                case "${clone_action}" in
                    "Update existing")
                        return 1  # Signal to do update instead
                        ;;
                    "Remove and re-clone")
                        log_warning "Removing existing project directory..."
                        run_sudo rm -rf "${project_dir}"
                        ;;
                    "Keep existing")
                        return 2  # Signal to skip
                        ;;
                esac
            else
                # Non-interactive: update existing
                return 1
            fi
        else
            log_warning "Directory exists but is not a git repository"
            
            if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
                if ask_yes_no "Remove existing directory and clone fresh?"; then
                    run_sudo rm -rf "${project_dir}"
                else
                    return 2  # Skip
                fi
            else
                run_sudo rm -rf "${project_dir}"
            fi
        fi
    fi
    
    # Create parent directory if needed
    run_sudo mkdir -p "$(dirname "${project_dir}")"
    
    return 0
}

do_clone_repository() {
    local username
    username=$(get_config "create_user" "bires")
    if [[ -z "${username}" ]]; then
        username=$(config_get "CREATE_USER" "bires")
    fi
    
    local project_dir
    project_dir=$(get_config "project_dir" "/home/${username}/bires")
    
    local repo
    repo=$(get_github_repo)
    
    log_info "Cloning repository: ${repo}"
    
    # Create parent directory first
    run_sudo mkdir -p "$(dirname "${project_dir}")"
    run_sudo chown "${username}:${username}" "$(dirname "${project_dir}")"
    
    # Clone as the target user to ensure correct ownership
    if is_low_profile_mode; then
        log_info "Using shallow clone (low-profile mode)"
        sudo -u "${username}" git clone --depth 1 "${repo}" "${project_dir}"
    else
        sudo -u "${username}" git clone "${repo}" "${project_dir}"
    fi
    
    if [[ ! -d "${project_dir}" ]]; then
        log_error "Failed to clone repository"
        return 1
    fi
    
    log_success "Repository cloned successfully"
}

do_update_repository() {
    local username
    username=$(get_config "create_user" "bires")
    if [[ -z "${username}" ]]; then
        username=$(config_get "CREATE_USER" "bires")
    fi
    
    local project_dir
    project_dir=$(get_config "project_dir" "/home/${username}/bires")
    
    log_info "Updating existing repository..."
    
    cd "${project_dir}" || return 1
    
    # Fix permissions before git operations (in case they're broken)
    run_sudo chown -R "${username}:${username}" "${project_dir}/.git"
    
    # Fetch and reset as the target user to maintain correct ownership
    sudo -u "${username}" git fetch origin
    sudo -u "${username}" git reset --hard origin/main 2>/dev/null || \
        sudo -u "${username}" git reset --hard origin/master
    
    cd - > /dev/null || true
    
    log_success "Repository updated"
}

do_set_permissions() {
    local username
    username=$(get_config "create_user" "bires")
    if [[ -z "${username}" ]]; then
        username=$(config_get "CREATE_USER" "bires")
    fi
    
    local project_dir
    project_dir=$(get_config "project_dir" "/home/${username}/bires")
    
    log_info "Setting file permissions..."
    
    # Set ownership
    run_sudo chown -R "${username}:${username}" "${project_dir}"
    
    # Make scripts executable
    if [[ -d "${project_dir}/scripts" ]]; then
        run_sudo chmod +x "${project_dir}/scripts/"*.sh 2>/dev/null || true
    fi
    
    # Make installer scripts executable
    if [[ -d "${project_dir}/scripts/installer" ]]; then
        run_sudo find "${project_dir}/scripts/installer" -name "*.sh" -exec chmod +x {} \;
    fi
    
    # Set nginx directory permissions
    if [[ -d "${project_dir}/nginx" ]]; then
        run_sudo chmod 755 -R "${project_dir}/nginx/"
    fi
    
    log_success "File permissions set"
}

do_verify_structure() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_info "Verifying project structure..."
    
    # Check for essential directories
    local required_dirs=(
        "backend"
        "frontend"
        "nginx"
        "docker"
    )
    
    local missing=()
    for dir in "${required_dirs[@]}"; do
        if [[ ! -d "${project_dir}/${dir}" ]]; then
            missing+=("${dir}")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_warning "Missing directories: ${missing[*]}"
        log_warning "The repository structure may be different than expected"
    fi
    
    # Check for essential files
    local required_files=(
        "docker-compose.yml"
        "docker-compose.prod.yml"
        "env.example"
    )
    
    missing=()
    for file in "${required_files[@]}"; do
        if [[ ! -f "${project_dir}/${file}" ]]; then
            missing+=("${file}")
        fi
    done
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_warning "Missing files: ${missing[*]}"
    else
        log_success "Project structure verified"
    fi
    
    return 0
}

do_create_directories() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_info "Creating additional directories..."
    
    # Create directories that might be needed
    run_sudo mkdir -p "${project_dir}/nginx/ssl"
    run_sudo mkdir -p "${project_dir}/backups"
    run_sudo mkdir -p "${project_dir}/logs"
    
    log_success "Additional directories created"
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
    
    # Prepare directory and check for existing
    do_prepare_directory
    local prep_result=$?
    
    case $prep_result in
        1)
            # Update existing repository
            if ! do_update_repository; then
                log_error "Failed to update repository"
                mark_step_failed "${MODULE_NAME}"
                return 1
            fi
            ;;
        2)
            # Skip cloning
            log_info "Keeping existing project directory"
            ;;
        0)
            # Clone fresh
            if ! do_clone_repository; then
                log_error "Failed to clone repository"
                mark_step_failed "${MODULE_NAME}"
                return 1
            fi
            ;;
    esac
    
    # Set permissions
    if ! do_set_permissions; then
        log_error "Failed to set permissions"
        mark_step_failed "${MODULE_NAME}"
        return 1
    fi
    
    # Verify structure
    do_verify_structure
    
    # Create additional directories
    do_create_directories
    
    mark_step_completed "${MODULE_NAME}"
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_success "Project cloned to: ${project_dir}"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
