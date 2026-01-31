#!/bin/bash
# =============================================================================
# B-IRES Platform - Main Installation Orchestrator
# =============================================================================
# This is the main installer script that coordinates all installation modules.
# It provides an interactive wizard with progress tracking and resume capability.
# =============================================================================

set -eE

# Version
readonly INSTALLER_VERSION="1.0.0"

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export BIRES_INSTALLER_DIR="${SCRIPT_DIR}"

# Source libraries
source "${SCRIPT_DIR}/lib/common.sh"
source "${SCRIPT_DIR}/lib/state-manager.sh"
source "${SCRIPT_DIR}/lib/config-parser.sh"
source "${SCRIPT_DIR}/lib/password-generator.sh"

# =============================================================================
# Global Variables
# =============================================================================

# Command line arguments
CONFIG_FILE=""
LOW_PROFILE_MODE="false"
NON_INTERACTIVE="false"

# Module list (in order)
MODULES=(
    "01-security-setup.sh"
    "02-docker-setup.sh"
    "03-clone-project.sh"
    "04-configure-env.sh"
    "05-ssl-setup.sh"
    "06-nginx-config.sh"
    "07-deploy-app.sh"
    "08-admin-user.sh"
    "09-firewall-setup.sh"
    "10-netdata-setup.sh"
)

# =============================================================================
# Helper Functions
# =============================================================================

show_help() {
    cat << EOF
B-IRES Platform Installation Wizard v${INSTALLER_VERSION}

Usage:
  ./bires-setup.sh [OPTIONS]

Options:
  --config FILE       Use configuration file for settings
  --low-profile       Enable low-memory mode (2GB RAM)
  --non-interactive   Run without prompts (requires --config)
  --resume            Resume previous installation
  --reset             Reset and start fresh
  --help              Show this help message

Examples:
  # Interactive installation
  ./bires-setup.sh

  # Installation with config file
  ./bires-setup.sh --config config.txt

  # Low-memory mode
  ./bires-setup.sh --low-profile

  # Unattended installation
  ./bires-setup.sh --config config.txt --non-interactive

EOF
}

parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --config)
                CONFIG_FILE="$2"
                shift 2
                ;;
            --low-profile)
                LOW_PROFILE_MODE="true"
                export BIRES_LOW_PROFILE="true"
                shift
                ;;
            --non-interactive)
                NON_INTERACTIVE="true"
                export BIRES_NON_INTERACTIVE="true"
                shift
                ;;
            --resume)
                # Resume is the default behavior
                shift
                ;;
            --reset)
                reset_state
                shift
                ;;
            --help|-h)
                show_help
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_help
                exit 1
                ;;
        esac
    done
    
    # Validate options
    if [[ "${NON_INTERACTIVE}" == "true" && -z "${CONFIG_FILE}" ]]; then
        log_error "--non-interactive requires --config option"
        exit 1
    fi
    
    if [[ -n "${CONFIG_FILE}" && ! -f "${CONFIG_FILE}" ]]; then
        log_error "Config file not found: ${CONFIG_FILE}"
        exit 1
    fi
}

# =============================================================================
# UI Functions
# =============================================================================

show_welcome() {
    clear
    print_banner
    echo -e "${FORMAT_BOLD}Version: ${INSTALLER_VERSION}${FORMAT_RESET}"
    echo ""
    echo "This wizard will guide you through the installation process."
    echo ""
    
    if [[ "${LOW_PROFILE_MODE}" == "true" ]]; then
        echo -e "${COLOR_YELLOW}Running in LOW-PROFILE mode (optimized for 2GB RAM)${COLOR_NC}"
        echo ""
    fi
    
    if [[ "${NON_INTERACTIVE}" == "true" ]]; then
        echo -e "${COLOR_YELLOW}Running in NON-INTERACTIVE mode${COLOR_NC}"
        echo ""
    fi
}

show_main_menu() {
    local completed
    completed=$(get_completed_steps_count)
    local total
    total=$(get_total_steps_count)
    
    echo ""
    show_progress "${completed}" "${total}"
    echo ""
    
    if [[ ${completed} -eq ${total} ]]; then
        echo -e "${COLOR_GREEN}All steps completed!${COLOR_NC}"
        return 1
    fi
    
    echo "Installation Steps:"
    echo ""
    
    local i=1
    for step_name in "${STEP_NAMES[@]}"; do
        local status
        status=$(get_step_status "${step_name}")
        local status_icon
        local status_color
        
        case "${status}" in
            completed)
                status_icon="✓"
                status_color="${COLOR_GREEN}"
                ;;
            skipped)
                status_icon="○"
                status_color="${COLOR_GRAY}"
                ;;
            in_progress)
                status_icon="▶"
                status_color="${COLOR_YELLOW}"
                ;;
            failed)
                status_icon="✗"
                status_color="${COLOR_RED}"
                ;;
            *)
                status_icon="○"
                status_color="${COLOR_WHITE}"
                ;;
        esac
        
        # Format step name
        local display_name
        display_name=$(echo "${step_name}" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')
        
        echo -e "  ${status_color}${status_icon}${COLOR_NC} ${i}. ${display_name}"
        
        ((i++))
    done
    
    echo ""
    return 0
}

# =============================================================================
# Module Execution
# =============================================================================

execute_module() {
    local module_file="$1"
    local module_path="${SCRIPT_DIR}/modules/${module_file}"
    
    if [[ ! -f "${module_path}" ]]; then
        log_error "Module not found: ${module_path}"
        return 1
    fi
    
    # Source and run the module
    source "${module_path}"
    run_module
    return $?
}

# Show step selection menu
show_step_selection_menu() {
    # Check if we have terminal access
    if ! ensure_tty; then
        log_info "No terminal available for input, continuing with default option (continue from next incomplete step)..."
        return 0
    fi
    
    echo ""
    echo -e "${FORMAT_BOLD}Installation Options:${FORMAT_RESET}"
    echo ""
    echo "  1. Continue from next incomplete step (default)"
    echo "  2. Choose a specific step to start from"
    echo "  3. Start fresh (reset all steps)"
    echo ""
    
    local choice
    echo -en "Enter your choice [1-3]: "
    read -r choice </dev/tty
    
    case "${choice}" in
        1|"")
            # Continue normally
            return 0
            ;;
        2)
            # Show step selection
            show_step_selection
            return $?
            ;;
        3)
            # Reset all and start fresh
            if ask_yes_no "This will reset all progress. Are you sure?"; then
                reset_state
                echo ""
                log_success "State reset. Starting fresh installation."
                echo ""
                return 0
            else
                return 1
            fi
            ;;
        *)
            log_error "Invalid choice"
            return 1
            ;;
    esac
}

# Show individual step selection
show_step_selection() {
    echo ""
    echo -e "${FORMAT_BOLD}Select a step to start from:${FORMAT_RESET}"
    echo ""
    
    local i=1
    for step_name in "${STEP_NAMES[@]}"; do
        local status
        status=$(get_step_status "${step_name}")
        local status_icon
        local status_color
        
        case "${status}" in
            completed)
                status_icon="✓"
                status_color="${COLOR_GREEN}"
                ;;
            skipped)
                status_icon="○"
                status_color="${COLOR_GRAY}"
                ;;
            in_progress)
                status_icon="▶"
                status_color="${COLOR_YELLOW}"
                ;;
            failed)
                status_icon="✗"
                status_color="${COLOR_RED}"
                ;;
            *)
                status_icon="○"
                status_color="${COLOR_WHITE}"
                ;;
        esac
        
        # Format step name
        local display_name
        display_name=$(echo "${step_name}" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')
        
        echo -e "  ${status_color}${status_icon}${COLOR_NC} ${i}. ${display_name}"
        
        ((i++))
    done
    
    echo ""
    echo "  0. Cancel and return to previous menu"
    echo ""
    
    local choice
    echo -en "Enter step number [0-${#STEP_NAMES[@]}]: "
    read -r choice </dev/tty
    
    # Validate input
    if [[ ! "${choice}" =~ ^[0-9]+$ ]]; then
        log_error "Invalid input. Please enter a number."
        return 1
    fi
    
    if [[ "${choice}" -eq 0 ]]; then
        return 1
    fi
    
    if [[ "${choice}" -lt 1 || "${choice}" -gt "${#STEP_NAMES[@]}" ]]; then
        log_error "Invalid step number"
        return 1
    fi
    
    # Reset from selected step onwards
    local step_index=$((choice - 1))
    local selected_step="${STEP_NAMES[$step_index]}"
    local display_name
    display_name=$(echo "${selected_step}" | sed 's/_/ /g' | sed 's/\b\(.\)/\u\1/g')
    
    echo ""
    echo "This will reset '${display_name}' and all subsequent steps."
    if ask_yes_no "Are you sure?"; then
        reset_from_step "${step_index}"
        echo ""
        log_success "Steps reset. Installation will start from step ${choice}."
        echo ""
        return 0
    else
        return 1
    fi
}

run_all_modules() {
    for module in "${MODULES[@]}"; do
        local step_name
        step_name=$(echo "${module}" | sed 's/^[0-9]*-//' | sed 's/\.sh$//' | sed 's/-/_/g')
        
        # Check if already done
        if is_step_done "${step_name}"; then
            log_debug "Skipping completed step: ${step_name}"
            continue
        fi
        
        log_info "Running module: ${module}"
        
        if ! execute_module "${module}"; then
            local exit_code=$?
            
            if [[ ${exit_code} -eq 2 ]]; then
                # User requested quit
                log_info "Installation paused. Run again to resume."
                return 0
            fi
            
            log_error "Module failed: ${module}"
            
            if [[ "${NON_INTERACTIVE}" == "true" ]]; then
                return 1
            fi
            
            echo ""
            if ask_yes_no "Continue with next step?"; then
                continue
            else
                log_info "Installation paused. Run again to resume."
                return 0
            fi
        fi
    done
    
    return 0
}

# =============================================================================
# Installation Summary
# =============================================================================

show_completion_summary() {
    local domain
    domain=$(get_config "domain" "localhost")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local protocol="https"
    [[ "${ssl_enabled}" != "true" ]] && protocol="http"
    
    local ip_address
    ip_address=$(get_config "ip_address" "")
    if [[ -z "${ip_address}" ]]; then
        ip_address=$(get_ip_address)
    fi
    
    local username
    username=$(get_config "create_user" "bires")
    local project_dir
    project_dir=$(get_config "project_dir" "/home/${username}/bires")
    
    clear
    echo -e "${COLOR_CYAN}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║         B-IRES Installation Complete!                        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${COLOR_NC}"
    
    echo -e "${FORMAT_BOLD}Your B-IRES platform is now running!${FORMAT_RESET}"
    echo ""
    
    echo -e "${FORMAT_BOLD}URLs:${FORMAT_RESET}"
    echo "  Main App:     ${protocol}://${domain}"
    echo "  Admin Panel:  ${protocol}://${domain}/admin"
    echo "  API:          ${protocol}://${domain}/api"
    
    local netdata_url
    netdata_url=$(get_config "netdata_url" "")
    if [[ -n "${netdata_url}" ]]; then
        echo "  Netdata:      ${netdata_url}"
    fi
    
    echo ""
    echo -e "${FORMAT_BOLD}Admin Credentials:${FORMAT_RESET}"
    echo "  Email:     $(get_config "admin_email" "admin@example.com")"
    echo "  Password:  [saved to ~/bires-credentials.txt]"
    
    echo ""
    echo -e "${FORMAT_BOLD}Credentials File:${FORMAT_RESET}"
    local creds_file="/home/${username}/bires-credentials.txt"
    if [[ -f "${creds_file}" ]]; then
        echo "  ${creds_file}"
    else
        # Export credentials to file
        creds_file=$(export_credentials_file)
        echo "  ${creds_file}"
    fi
    
    echo ""
    echo -e "${FORMAT_BOLD}Management Commands:${FORMAT_RESET}"
    echo "  Start:     bash ${project_dir}/scripts/start-prod.sh"
    echo "  Stop:      bash ${project_dir}/scripts/stop-prod.sh"
    echo "  Restart:   bash ${project_dir}/scripts/restart-prod.sh"
    echo "  Logs:      cd ${project_dir} && docker compose logs -f"
    
    echo ""
    echo -e "${FORMAT_BOLD}Next Steps:${FORMAT_RESET}"
    echo "  1. Log in to the admin panel and change the default password"
    echo "  2. Create your first experiment"
    echo "  3. Set up regular backups (see ${project_dir}/scripts/backup-bires.sh)"
    
    echo ""
    echo -e "${COLOR_CYAN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${COLOR_NC}"
    echo ""
    
    # Mark installation as complete
    mark_installation_complete
    
    log_to_file "COMPLETE" "Installation completed successfully"
}

# =============================================================================
# Main Function
# =============================================================================

main() {
    # Parse command line arguments
    parse_arguments "$@"
    
    # Initialize state
    init_state
    
    # Save system info
    save_system_info
    
    # Load configuration
    if [[ -n "${CONFIG_FILE}" ]]; then
        if ! load_config_with_state "${CONFIG_FILE}"; then
            log_error "Failed to load configuration"
            exit 1
        fi
    fi
    
    # Set low profile mode from config if specified
    if config_is_enabled "LOW_PROFILE_MODE"; then
        LOW_PROFILE_MODE="true"
        export BIRES_LOW_PROFILE="true"
    fi
    
    # Show welcome screen
    show_welcome
    
    # Check for resume
    if has_previous_state && ! is_installation_complete; then
        if [[ "${NON_INTERACTIVE}" != "true" ]]; then
            prompt_resume
        fi
    fi
    
    # Show main menu and current status
    if ! show_main_menu; then
        # All steps completed
        show_completion_summary
        exit 0
    fi
    
    # Ask to start/continue with step selection
    if [[ "${NON_INTERACTIVE}" != "true" ]]; then
        if ! show_step_selection_menu; then
            log_info "Installation cancelled"
            exit 0
        fi
    fi
    
    # Run all modules
    if ! run_all_modules; then
        log_error "Installation failed"
        exit 1
    fi
    
    # Check if all complete
    local completed
    completed=$(get_completed_steps_count)
    local total
    total=$(get_total_steps_count)
    
    if [[ ${completed} -ge ${total} ]]; then
        show_completion_summary
    else
        echo ""
        echo "Installation progress saved."
        echo "Run this script again to continue."
        echo ""
    fi
}

# =============================================================================
# Error Handler
# =============================================================================

error_handler() {
    local exit_code=$1
    local line_no=$2
    
    log_error "Script error at line ${line_no} (exit code: ${exit_code})"
    log_to_file "ERROR" "Script error at line ${line_no}, exit code: ${exit_code}"
    
    echo ""
    echo "Installation progress has been saved."
    echo "Run this script again to resume from where you left off."
    echo ""
}

trap 'error_handler $? $LINENO' ERR

# =============================================================================
# Run Main
# =============================================================================

main "$@"
