#!/bin/bash
# =============================================================================
# B-IRES Installer - Common Functions Library
# =============================================================================
# This file contains shared functions used across all installer modules.
# Source this file at the beginning of each module.
# =============================================================================

# Prevent multiple inclusion
[[ -n "${BIRES_COMMON_LOADED}" ]] && return 0
readonly BIRES_COMMON_LOADED="true"

# =============================================================================
# Colors and Formatting
# =============================================================================

# Colors
readonly COLOR_RED='\033[0;31m'
readonly COLOR_GREEN='\033[0;32m'
readonly COLOR_YELLOW='\033[1;33m'
readonly COLOR_BLUE='\033[0;34m'
readonly COLOR_MAGENTA='\033[0;35m'
readonly COLOR_CYAN='\033[0;36m'
readonly COLOR_WHITE='\033[1;37m'
readonly COLOR_GRAY='\033[0;90m'
readonly COLOR_NC='\033[0m' # No Color

# Formatting
readonly FORMAT_BOLD='\033[1m'
readonly FORMAT_DIM='\033[2m'
readonly FORMAT_UNDERLINE='\033[4m'
readonly FORMAT_RESET='\033[0m'

# Box drawing characters
readonly BOX_TOP_LEFT='╔'
readonly BOX_TOP_RIGHT='╗'
readonly BOX_BOTTOM_LEFT='╚'
readonly BOX_BOTTOM_RIGHT='╝'
readonly BOX_HORIZONTAL='═'
readonly BOX_VERTICAL='║'
readonly BOX_LINE='━'

# =============================================================================
# Logging Functions
# =============================================================================

# Log file location
LOG_FILE="${BIRES_STATE_DIR:-/var/lib/bires}/install.log"

# Initialize log file
init_log() {
    local log_dir
    log_dir=$(dirname "${LOG_FILE}")
    mkdir -p "${log_dir}" 2>/dev/null || true
    touch "${LOG_FILE}" 2>/dev/null || true
    chmod 600 "${LOG_FILE}" 2>/dev/null || true
}

# Log to file only
log_to_file() {
    local level="$1"
    local message="$2"
    local timestamp
    timestamp=$(date '+%Y-%m-%d %H:%M:%S')
    echo "[${timestamp}] [${level}] ${message}" >> "${LOG_FILE}" 2>/dev/null || true
}

# Log info message
log_info() {
    local message="$1"
    echo -e "${COLOR_BLUE}[INFO]${COLOR_NC} ${message}"
    log_to_file "INFO" "${message}"
}

# Log success message
log_success() {
    local message="$1"
    echo -e "${COLOR_GREEN}[SUCCESS]${COLOR_NC} ${message}"
    log_to_file "SUCCESS" "${message}"
}

# Log warning message
log_warning() {
    local message="$1"
    echo -e "${COLOR_YELLOW}[WARNING]${COLOR_NC} ${message}"
    log_to_file "WARNING" "${message}"
}

# Log error message
log_error() {
    local message="$1"
    echo -e "${COLOR_RED}[ERROR]${COLOR_NC} ${message}" >&2
    log_to_file "ERROR" "${message}"
}

# Log debug message (only when DEBUG is set)
log_debug() {
    if [[ "${BIRES_DEBUG:-false}" == "true" ]]; then
        local message="$1"
        echo -e "${COLOR_GRAY}[DEBUG]${COLOR_NC} ${message}"
        log_to_file "DEBUG" "${message}"
    fi
}

# Log step header
log_step() {
    local step_num="$1"
    local step_name="$2"
    echo ""
    echo -e "${COLOR_CYAN}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${COLOR_NC}"
    echo -e "${FORMAT_BOLD}Step ${step_num}: ${step_name}${FORMAT_RESET}"
    echo -e "${COLOR_CYAN}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${BOX_LINE}${COLOR_NC}"
    echo ""
    log_to_file "STEP" "Starting Step ${step_num}: ${step_name}"
}

# =============================================================================
# User Interaction Functions
# =============================================================================

# Helper function to check if we can read from terminal
# Usage: ensure_tty
# Returns 0 if terminal is available (stdin is tty or /dev/tty exists), 1 if not
ensure_tty() {
    if [[ -t 0 ]]; then
        return 0  # stdin is already a terminal
    fi
    
    # stdin is not a terminal, check if /dev/tty is available
    if [[ -r /dev/tty ]]; then
        return 0  # We can read from /dev/tty
    fi
    
    return 1  # No terminal available
}

# Ask yes/no question
# Returns 0 for yes, 1 for no
ask_yes_no() {
    local prompt="$1"
    local default="${2:-y}"  # Default to yes
    local response
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" == "true" ]]; then
        [[ "${default}" == "y" ]] && return 0 || return 1
    fi
    
    # Ensure we have a terminal for input
    if ! ensure_tty; then
        log_warning "No terminal available for input, using default: ${default}"
        [[ "${default}" == "y" ]] && return 0 || return 1
    fi
    
    if [[ "${default}" == "y" ]]; then
        prompt="${prompt} [Y/n]: "
    else
        prompt="${prompt} [y/N]: "
    fi
    
    while true; do
        echo -en "${COLOR_YELLOW}${prompt}${COLOR_NC}"
        read -r response </dev/tty
        response="${response:-$default}"
        response=$(echo "${response}" | tr '[:upper:]' '[:lower:]')
        
        case "${response}" in
            y|yes) return 0 ;;
            n|no) return 1 ;;
            *) echo "Please answer yes or no." ;;
        esac
    done
}

# Ask for text input
# Usage: ask_input "Prompt" "default_value" "variable_name"
ask_input() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    local response
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" == "true" ]]; then
        eval "${var_name}='${default}'"
        return 0
    fi
    
    # Ensure we have a terminal for input
    if ! ensure_tty; then
        log_warning "No terminal available for input, using default: ${default}"
        eval "${var_name}='${default}'"
        return 0
    fi
    
    if [[ -n "${default}" ]]; then
        echo -en "${COLOR_YELLOW}${prompt} [${default}]: ${COLOR_NC}"
    else
        echo -en "${COLOR_YELLOW}${prompt}: ${COLOR_NC}"
    fi
    
    read -r response </dev/tty
    response="${response:-$default}"
    eval "${var_name}='${response}'"
}

# Ask for password input (hidden)
ask_password() {
    local prompt="$1"
    local var_name="$2"
    local confirm="${3:-true}"
    local password
    local password_confirm
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" == "true" ]]; then
        eval "${var_name}=''"
        return 0
    fi
    
    # Ensure we have a terminal for input
    if ! ensure_tty; then
        log_warning "No terminal available for password input"
        eval "${var_name}=''"
        return 0
    fi
    
    while true; do
        echo -en "${COLOR_YELLOW}${prompt}: ${COLOR_NC}"
        read -rs password </dev/tty
        echo ""
        
        if [[ -z "${password}" ]]; then
            echo "Password cannot be empty."
            continue
        fi
        
        if [[ "${confirm}" == "true" ]]; then
            echo -en "${COLOR_YELLOW}Confirm password: ${COLOR_NC}"
            read -rs password_confirm </dev/tty
            echo ""
            
            if [[ "${password}" != "${password_confirm}" ]]; then
                echo "Passwords do not match. Please try again."
                continue
            fi
        fi
        
        break
    done
    
    eval "${var_name}='${password}'"
}

# Ask for choice from menu
# Usage: ask_choice "Prompt" "option1|option2|option3" "variable_name" "default_option"
ask_choice() {
    local prompt="$1"
    local options="$2"
    local var_name="$3"
    local default="$4"
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" == "true" ]]; then
        eval "${var_name}='${default}'"
        return 0
    fi
    
    # Ensure we have a terminal for input
    if ! ensure_tty; then
        log_warning "No terminal available for input, using default: ${default}"
        eval "${var_name}='${default}'"
        return 0
    fi
    
    IFS='|' read -ra opts <<< "${options}"
    
    echo -e "${COLOR_YELLOW}${prompt}${COLOR_NC}"
    local i=1
    for opt in "${opts[@]}"; do
        if [[ "${opt}" == "${default}" ]]; then
            echo -e "  ${COLOR_GREEN}${i})${COLOR_NC} ${opt} (default)"
        else
            echo -e "  ${COLOR_WHITE}${i})${COLOR_NC} ${opt}"
        fi
        ((i++))
    done
    
    while true; do
        echo -en "${COLOR_YELLOW}Enter choice [1-${#opts[@]}]: ${COLOR_NC}"
        read -r response </dev/tty
        
        if [[ -z "${response}" && -n "${default}" ]]; then
            eval "${var_name}='${default}'"
            return 0
        fi
        
        if [[ "${response}" =~ ^[0-9]+$ ]] && (( response >= 1 && response <= ${#opts[@]} )); then
            eval "${var_name}='${opts[$((response-1))]}'"
            return 0
        fi
        
        echo "Invalid choice. Please enter a number between 1 and ${#opts[@]}."
    done
}

# Ask for step action (yes/skip/quit)
# Returns: 0 = proceed, 1 = skip, 2 = quit
ask_step_action() {
    local step_name="$1"
    local description="$2"
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" == "true" ]]; then
        return 0  # Always proceed in non-interactive mode
    fi
    
    # Ensure we have a terminal for input
    if ! ensure_tty; then
        log_warning "No terminal available for input, proceeding with default action"
        return 0
    fi
    
    echo ""
    echo -e "${FORMAT_BOLD}This step will:${FORMAT_RESET}"
    echo -e "${description}"
    echo ""
    
    while true; do
        echo -en "${COLOR_YELLOW}[Y]es, proceed  [s]kip  [q]uit and save progress: ${COLOR_NC}"
        read -r response </dev/tty
        response=$(echo "${response}" | tr '[:upper:]' '[:lower:]')
        response="${response:-y}"
        
        case "${response}" in
            y|yes) return 0 ;;
            s|skip) return 1 ;;
            q|quit) return 2 ;;
            *) echo "Please enter Y, s, or q." ;;
        esac
    done
}

# =============================================================================
# Progress Display Functions
# =============================================================================

# Display progress bar
# Usage: show_progress current_step total_steps
show_progress() {
    local current="$1"
    local total="$2"
    local width=40
    local percentage=$((current * 100 / total))
    local filled=$((current * width / total))
    local empty=$((width - filled))
    
    local bar=""
    for ((i=0; i<filled; i++)); do bar+="█"; done
    for ((i=0; i<empty; i++)); do bar+="░"; done
    
    echo -e "${COLOR_CYAN}Progress: [${bar}] ${percentage}% (${current}/${total} steps completed)${COLOR_NC}"
}

# Display spinner while command runs
# Usage: run_with_spinner "message" command args...
run_with_spinner() {
    local message="$1"
    shift
    local pid
    local spin_chars='⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
    local i=0
    
    # Run command in background
    "$@" &
    pid=$!
    
    # Show spinner
    while kill -0 "$pid" 2>/dev/null; do
        printf "\r${COLOR_CYAN}[%s]${COLOR_NC} %s" "${spin_chars:i++%${#spin_chars}:1}" "${message}"
        sleep 0.1
    done
    
    # Wait for command and get exit code
    wait "$pid"
    local exit_code=$?
    
    # Clear spinner line
    printf "\r%*s\r" $((${#message} + 10)) ""
    
    return $exit_code
}

# =============================================================================
# UI Box Functions
# =============================================================================

# Print a box with title
# Usage: print_box "Title" "content line 1" "content line 2" ...
print_box() {
    local title="$1"
    shift
    local width=60
    local padding=2
    
    # Top border
    echo -en "${COLOR_CYAN}${BOX_TOP_LEFT}"
    for ((i=0; i<width; i++)); do echo -en "${BOX_HORIZONTAL}"; done
    echo -e "${BOX_TOP_RIGHT}${COLOR_NC}"
    
    # Title line
    local title_len=${#title}
    local title_padding=$(( (width - title_len) / 2 ))
    echo -en "${COLOR_CYAN}${BOX_VERTICAL}${COLOR_NC}"
    printf "%*s${FORMAT_BOLD}%s${FORMAT_RESET}%*s" $title_padding "" "${title}" $((width - title_len - title_padding)) ""
    echo -e "${COLOR_CYAN}${BOX_VERTICAL}${COLOR_NC}"
    
    # Empty line
    echo -en "${COLOR_CYAN}${BOX_VERTICAL}${COLOR_NC}"
    printf "%*s" $width ""
    echo -e "${COLOR_CYAN}${BOX_VERTICAL}${COLOR_NC}"
    
    # Content lines
    for line in "$@"; do
        echo -en "${COLOR_CYAN}${BOX_VERTICAL}${COLOR_NC}"
        printf "  %-$((width-4))s  " "${line}"
        echo -e "${COLOR_CYAN}${BOX_VERTICAL}${COLOR_NC}"
    done
    
    # Bottom border
    echo -en "${COLOR_CYAN}${BOX_BOTTOM_LEFT}"
    for ((i=0; i<width; i++)); do echo -en "${BOX_HORIZONTAL}"; done
    echo -e "${BOX_BOTTOM_RIGHT}${COLOR_NC}"
}

# Print banner
print_banner() {
    echo -e "${COLOR_CYAN}"
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║    ██████╗       ██╗██████╗ ███████╗███████╗                ║
║    ██╔══██╗      ██║██╔══██╗██╔════╝██╔════╝                ║
║    ██████╔╝█████╗██║██████╔╝█████╗  ███████╗                ║
║    ██╔══██╗╚════╝██║██╔══██╗██╔══╝  ╚════██║                ║
║    ██████╔╝      ██║██║  ██║███████╗███████║                ║
║    ╚═════╝       ╚═╝╚═╝  ╚═╝╚══════╝╚══════╝                ║
║                                                              ║
║         Bar-Ilan Research Evaluation System                  ║
║              Platform Installation Wizard                    ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
EOF
    echo -e "${COLOR_NC}"
}

# =============================================================================
# Error Handling Functions
# =============================================================================

# Error handler
# Usage: trap 'error_handler $? $LINENO' ERR
error_handler() {
    local exit_code="$1"
    local line_no="$2"
    local command="${BASH_COMMAND}"
    
    log_error "Command failed with exit code ${exit_code} at line ${line_no}"
    log_error "Command: ${command}"
    log_to_file "ERROR" "Exit code: ${exit_code}, Line: ${line_no}, Command: ${command}"
}

# Setup error handling for a module
setup_error_handling() {
    set -eE
    trap 'error_handler $? $LINENO' ERR
}

# Cleanup function
cleanup() {
    # Remove temporary files
    rm -f /tmp/bires_* 2>/dev/null || true
}

# Setup cleanup trap
setup_cleanup() {
    trap cleanup EXIT
}

# =============================================================================
# Utility Functions
# =============================================================================

# Check if command exists
command_exists() {
    command -v "$1" &> /dev/null
}

# Check if running as root
is_root() {
    [[ $EUID -eq 0 ]]
}

# Get sudo prefix
get_sudo() {
    if is_root; then
        echo ""
    else
        echo "sudo"
    fi
}

# Run command with sudo if needed
run_sudo() {
    if is_root; then
        "$@"
    else
        sudo "$@"
    fi
}

# Wait for apt lock
wait_for_apt() {
    local max_wait=60
    local count=0
    
    while fuser /var/lib/dpkg/lock-frontend >/dev/null 2>&1 || \
          fuser /var/lib/apt/lists/lock >/dev/null 2>&1 || \
          fuser /var/cache/apt/archives/lock >/dev/null 2>&1; do
        if [[ $count -eq 0 ]]; then
            log_info "Waiting for apt lock to be released..."
        fi
        sleep 2
        count=$((count + 1))
        if [[ $count -ge $max_wait ]]; then
            log_error "Timeout waiting for apt lock"
            return 1
        fi
    done
}

# Install package if not present
ensure_package() {
    local package="$1"
    
    if ! dpkg -l "${package}" &> /dev/null; then
        log_info "Installing ${package}..."
        wait_for_apt
        run_sudo apt-get install -y "${package}"
    fi
}

# Check if service is running
is_service_running() {
    local service="$1"
    systemctl is-active --quiet "${service}"
}

# Validate email format
is_valid_email() {
    local email="$1"
    [[ "${email}" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]]
}

# Validate domain format
is_valid_domain() {
    local domain="$1"
    [[ "${domain}" =~ ^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z]{2,})+$ ]]
}

# Get IP address
get_ip_address() {
    curl -s ifconfig.me 2>/dev/null || \
    curl -s icanhazip.com 2>/dev/null || \
    hostname -I | awk '{print $1}'
}

# Create backup of file
backup_file() {
    local file="$1"
    local backup_dir="${BIRES_STATE_DIR:-/var/lib/bires}/backups"
    
    if [[ -f "${file}" ]]; then
        mkdir -p "${backup_dir}"
        local filename
        filename=$(basename "${file}")
        local timestamp
        timestamp=$(date +%Y%m%d_%H%M%S)
        cp "${file}" "${backup_dir}/${filename}.${timestamp}.bak"
        log_debug "Backed up ${file} to ${backup_dir}/${filename}.${timestamp}.bak"
    fi
}

# Initialize common functions
init_common() {
    init_log
    setup_cleanup
}

# Auto-initialize if this is the first inclusion
init_common
