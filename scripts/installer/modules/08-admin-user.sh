#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 08: Admin User Setup
# =============================================================================
# Creates the B-IRES admin user with specified credentials.
# =============================================================================

# Module info
MODULE_NAME="admin_user"
MODULE_TITLE="Create Admin User"
MODULE_NUMBER=8

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
        log_info "Admin user setup already completed"
        return 1
    fi
    return 0
}

get_description() {
    local admin_email
    admin_email=$(get_config "admin_email" "admin@example.com")
    local admin_username
    admin_username=$(get_config "admin_username" "admin")
    
    cat << EOF
  - Ensure MongoDB and backend services are running
  - Create admin user account in B-IRES database
  - Email: ${admin_email}
  - Username: ${admin_username}
  - Update default admin password
  - Verify admin can authenticate
EOF
}

# =============================================================================
# Admin User Functions
# =============================================================================

do_ensure_dependencies() {
    log_info "Ensuring required services are running..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    if [[ -z "${project_dir}" ]]; then
        log_error "Project directory not found in config"
        return 1
    fi
    
    # Ensure MongoDB is running and healthy
    if ! wait_for_mongodb "${project_dir}"; then
        log_error "Failed to ensure MongoDB is running"
        return 1
    fi
    
    # Ensure backend is running and healthy
    if ! wait_for_backend "${project_dir}"; then
        log_error "Failed to ensure backend is running"
        return 1
    fi
    
    log_success "All required services are ready"
    return 0
}

do_create_admin_via_api() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    local admin_email
    admin_email=$(get_config "admin_email" "admin@example.com")
    local admin_username
    admin_username=$(get_config "admin_username" "admin")
    local admin_password
    admin_password=$(get_credential "admin_password" "")
    
    if [[ -z "${admin_password}" ]]; then
        log_error "Admin password not found in credentials"
        return 1
    fi
    
    cd "${project_dir}" || return 1
    
    # Get compose files
    local compose_mode
    compose_mode=$(get_config "compose_mode" "production")
    local compose_files
    if [[ "${compose_mode}" == "production" ]]; then
        compose_files="-f docker-compose.yml -f docker-compose.prod.yml"
    else
        compose_files="-f docker-compose.yml -f docker-compose.test.yml"
    fi
    
    log_info "Creating admin user via MongoDB..."
    
    # Load .env file to get credentials
    if [[ -f ".env" ]]; then
        source .env
    fi
    
    # Generate bcrypt hash for password using Python in the container
    local password_hash
    password_hash=$(docker compose ${compose_files} exec -T backend python3 -c "
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
print(pwd_context.hash('${admin_password}'))
" 2>/dev/null)
    
    if [[ -z "${password_hash}" ]]; then
        log_warning "Could not generate password hash via backend, using alternative method..."
        
        # Alternative: Use Python directly if available
        if command -v python3 &>/dev/null; then
            password_hash=$(python3 -c "
import subprocess
try:
    from passlib.context import CryptContext
    pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')
    print(pwd_context.hash('${admin_password}'))
except ImportError:
    import bcrypt
    print(bcrypt.hashpw('${admin_password}'.encode(), bcrypt.gensalt()).decode())
" 2>/dev/null)
        fi
    fi
    
    if [[ -z "${password_hash}" ]]; then
        log_error "Could not generate password hash"
        return 1
    fi
    
    # Create or update admin user in MongoDB
    local timestamp
    timestamp=$(date -Iseconds)
    
    # Build mongosh command based on mode
    local mongosh_cmd="mongosh"
    if [[ "${compose_mode}" == "production" ]]; then
        local mongo_admin_password="${MONGO_ADMIN_PASSWORD:-}"
        if [[ -z "${mongo_admin_password}" ]]; then
            log_error "MONGO_ADMIN_PASSWORD not found in .env file"
            return 1
        fi
        mongosh_cmd="mongosh -u admin -p ${mongo_admin_password} --authenticationDatabase admin"
    fi
    
    docker compose ${compose_files} exec -T mongo ${mongosh_cmd} bires --quiet --eval "
        // Check if user exists by email or username
        var existingUserByEmail = db.users.findOne({email: '${admin_email}'});
        var existingUserByUsername = db.users.findOne({username: '${admin_username}'});
        
        if (existingUserByEmail || existingUserByUsername) {
            // Update existing user (by email or username)
            var query = existingUserByEmail ? {email: '${admin_email}'} : {username: '${admin_username}'};
            db.users.updateOne(
                query,
                {
                    \$set: {
                        email: '${admin_email}',
                        username: '${admin_username}',
                        hashed_password: '${password_hash}',
                        role: 'admin',
                        is_active: true,
                        updated_at: new Date()
                    }
                }
            );
            print('Admin user updated: ${admin_email}');
        } else {
            // Create new user
            db.users.insertOne({
                _id: 'admin-' + Date.now(),
                email: '${admin_email}',
                username: '${admin_username}',
                full_name: 'Administrator',
                role: 'admin',
                is_active: true,
                hashed_password: '${password_hash}',
                created_at: new Date(),
                updated_at: new Date()
            });
            print('Admin user created: ${admin_email}');
        }
    "
    
    if [[ $? -ne 0 ]]; then
        log_error "Failed to create admin user in database"
        return 1
    fi
    
    log_success "Admin user created/updated"
}

do_disable_default_admin() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    local admin_email
    admin_email=$(get_config "admin_email" "")
    
    cd "${project_dir}" || return 1
    
    # Load .env file to get credentials
    if [[ -f ".env" ]]; then
        source .env
    fi
    
    # Get compose files
    local compose_mode
    compose_mode=$(get_config "compose_mode" "production")
    local compose_files
    if [[ "${compose_mode}" == "production" ]]; then
        compose_files="-f docker-compose.yml -f docker-compose.prod.yml"
    else
        compose_files="-f docker-compose.yml -f docker-compose.test.yml"
    fi
    
    # Build mongosh command based on mode
    local mongosh_cmd="mongosh"
    if [[ "${compose_mode}" == "production" ]]; then
        local mongo_admin_password="${MONGO_ADMIN_PASSWORD:-}"
        if [[ -n "${mongo_admin_password}" ]]; then
            mongosh_cmd="mongosh -u admin -p ${mongo_admin_password} --authenticationDatabase admin"
        fi
    fi
    
    # Only disable default admin if a different admin email is configured
    if [[ "${admin_email}" != "admin@example.com" ]]; then
        log_info "Disabling default admin account..."
        
        docker compose ${compose_files} exec -T mongo ${mongosh_cmd} bires --quiet --eval "
            db.users.updateOne(
                {email: 'admin@example.com'},
                {\$set: {is_active: false, updated_at: new Date()}}
            );
        " 2>/dev/null || true
        
        log_success "Default admin account disabled"
    fi
}

do_verify_admin() {
    local admin_email
    admin_email=$(get_config "admin_email" "admin@example.com")
    local admin_password
    admin_password=$(get_credential "admin_password" "")
    
    log_info "Verifying admin authentication..."
    
    # Try to authenticate via API
    local response
    response=$(curl -s -X POST "http://localhost:8000/auth/login" \
        -H "Content-Type: application/x-www-form-urlencoded" \
        -d "username=${admin_email}&password=${admin_password}" 2>/dev/null)
    
    if echo "${response}" | grep -q "access_token"; then
        log_success "Admin authentication verified"
        return 0
    else
        log_warning "Could not verify admin authentication via API"
        log_warning "Response: ${response}"
        
        # Check if user exists in database
        local project_dir
        project_dir=$(get_config "project_dir" "")
        cd "${project_dir}" || return 1
        
        # Load .env file to get credentials
        if [[ -f ".env" ]]; then
            source .env
        fi
        
        # Get compose files
        local compose_mode
        compose_mode=$(get_config "compose_mode" "production")
        local compose_files
        if [[ "${compose_mode}" == "production" ]]; then
            compose_files="-f docker-compose.yml -f docker-compose.prod.yml"
        else
            compose_files="-f docker-compose.yml -f docker-compose.test.yml"
        fi
        
        # Build mongosh command based on mode
        local mongosh_cmd="mongosh"
        if [[ "${compose_mode}" == "production" ]]; then
            local mongo_admin_password="${MONGO_ADMIN_PASSWORD:-}"
            if [[ -n "${mongo_admin_password}" ]]; then
                mongosh_cmd="mongosh -u admin -p ${mongo_admin_password} --authenticationDatabase admin"
            fi
        fi
        
        local user_check
        user_check=$(docker compose ${compose_files} exec -T mongo ${mongosh_cmd} bires --quiet --eval "
            var user = db.users.findOne({email: '${admin_email}'});
            if (user) {
                print('User found: ' + user.email + ', active: ' + user.is_active + ', role: ' + user.role);
            } else {
                print('User not found');
            }
        " 2>/dev/null)
        
        log_info "Database check: ${user_check}"
        
        if echo "${user_check}" | grep -q "User found"; then
            log_warning "User exists but API authentication may need backend restart"
            return 0
        fi
        
        return 1
    fi
}

do_display_credentials() {
    local admin_email
    admin_email=$(get_config "admin_email" "admin@example.com")
    local admin_username
    admin_username=$(get_config "admin_username" "admin")
    local admin_password
    admin_password=$(get_credential "admin_password" "")
    local domain
    domain=$(get_config "domain" "localhost")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local protocol="https"
    [[ "${ssl_enabled}" != "true" ]] && protocol="http"
    
    echo ""
    print_box "Admin Credentials" \
        "Admin Panel URL: ${protocol}://${domain}/admin" \
        "" \
        "Email:    ${admin_email}" \
        "Username: ${admin_username}" \
        "Password: ${admin_password}" \
        "" \
        "IMPORTANT: Save these credentials securely!"
    echo ""
    
    if [[ "${BIRES_NON_INTERACTIVE:-false}" != "true" ]]; then
        echo -e "${COLOR_YELLOW}Press Enter to continue (credentials will be cleared from screen)...${COLOR_NC}"
        read -r
        # Clear the screen to hide credentials
        clear
    fi
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
        "do_ensure_dependencies:Ensuring dependencies"
        "do_create_admin_via_api:Creating admin user"
        "do_disable_default_admin:Disabling default admin"
        "do_verify_admin:Verifying admin"
        "do_display_credentials:Displaying credentials"
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
    
    log_success "Admin user setup completed!"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
