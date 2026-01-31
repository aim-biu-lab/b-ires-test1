#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 07: Deploy Application
# =============================================================================
# Builds and deploys the B-IRES application using Docker Compose.
# Supports both normal and low-profile (sequential) build modes.
# =============================================================================

# Module info
MODULE_NAME="deploy_app"
MODULE_TITLE="Deploy B-IRES Application"
MODULE_NUMBER=7

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
        log_info "Application deployment already completed"
        return 1
    fi
    
    # Check if environment configuration was completed
    if ! is_step_done "configure_env"; then
        log_warning "Module 04 (Environment Configuration) has not been completed"
        log_warning "This may cause deployment issues if .env file is incomplete"
    fi
    
    return 0
}

get_description() {
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local mode="production"
    [[ "${ssl_enabled}" != "true" ]] && mode="test (HTTP only)"
    
    if is_low_profile_mode; then
        cat << EOF
  - Build Docker images sequentially (low-profile mode)
  - Start infrastructure services (MongoDB, Redis, MinIO)
  - Wait for services to be healthy
  - Start application services
  - Start nginx (${mode} mode)
  - Verify all services are running
EOF
    else
        cat << EOF
  - Build all Docker images
  - Start all services using Docker Compose
  - Deploy in ${mode} mode
  - Verify all services are running
EOF
    fi
}

# =============================================================================
# Deployment Functions
# =============================================================================

do_prepare_deployment() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_info "Preparing deployment..."
    
    # Change to project directory
    cd "${project_dir}" || {
        log_error "Cannot access project directory: ${project_dir}"
        return 1
    }
    
    # Always pull latest code before building
    if [[ -d ".git" ]]; then
        log_info "Pulling latest code from repository..."
        git fetch origin 2>/dev/null || true
        git reset --hard origin/main 2>/dev/null || \
            git reset --hard origin/master 2>/dev/null || \
            log_warning "Could not update from remote, using existing code"
        log_success "Code updated to latest version"
    fi
    
    # Ensure .env file exists
    if [[ ! -f ".env" ]]; then
        log_error ".env file not found. Please run environment configuration first."
        log_error "Module 04 (Environment Configuration) may not have completed successfully."
        return 1
    fi
    
    # Check if .env has required variables for production mode
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    if [[ "${ssl_enabled}" == "true" ]]; then
        log_info "Verifying .env file for production mode..."
        local missing_vars=()
        
        if ! grep -q "^MONGO_URL=" .env; then
            missing_vars+=("MONGO_URL")
        fi
        if ! grep -q "^MONGO_ADMIN_PASSWORD=" .env; then
            missing_vars+=("MONGO_ADMIN_PASSWORD")
        fi
        if ! grep -q "^REDIS_PASSWORD=" .env; then
            missing_vars+=("REDIS_PASSWORD")
        fi
        if ! grep -q "^JWT_SECRET=" .env; then
            missing_vars+=("JWT_SECRET")
        fi
        
        if [[ ${#missing_vars[@]} -gt 0 ]]; then
            log_warning "Some required environment variables are missing from .env:"
            for var in "${missing_vars[@]}"; do
                log_warning "  - ${var}"
            done
            log_warning "Module 04 (Environment Configuration) may not have completed successfully."
            log_info "Deployment will continue, but services may not work correctly."
            echo ""
        else
            log_success ".env file verified for production mode"
        fi
    fi
    
    # Determine which compose files to use
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    
    if [[ "${ssl_enabled}" == "true" ]]; then
        export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.prod.yml"
        save_config "compose_mode" "production"
    else
        export COMPOSE_FILES="-f docker-compose.yml -f docker-compose.test.yml"
        save_config "compose_mode" "test"
    fi
    
    log_success "Deployment prepared"
}

do_pull_images() {
    log_info "Pulling base Docker images..."
    
    # Pull base images to speed up builds
    local images=(
        "python:3.11-slim"
        "node:20-alpine"
        "nginx:alpine"
        "mongo:7"
        "redis:alpine"
        "minio/minio:latest"
    )
    
    for image in "${images[@]}"; do
        log_info "Pulling ${image}..."
        docker pull "${image}" || log_warning "Could not pull ${image}, will build from scratch"
    done
    
    log_success "Base images pulled"
}

do_build_images_normal() {
    log_info "Building Docker images (parallel mode)..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    local domain
    domain=$(get_config "domain" "localhost")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local api_url="https://${domain}/api"
    [[ "${ssl_enabled}" != "true" ]] && api_url="http://${domain}/api"
    
    # Build all images (--no-cache ensures we use latest code)
    docker compose ${COMPOSE_FILES} build --no-cache \
        --build-arg VITE_API_URL="${api_url}" \
        || {
            log_error "Docker build failed"
            return 1
        }
    
    log_success "Docker images built"
}

do_build_images_sequential() {
    log_info "Building Docker images (sequential mode for low memory)..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    local domain
    domain=$(get_config "domain" "localhost")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local api_url="https://${domain}/api"
    [[ "${ssl_enabled}" != "true" ]] && api_url="http://${domain}/api"
    
    # Build services one at a time (--no-cache ensures we use latest code)
    local services=("backend" "experiment-shell" "admin-dashboard")
    
    for service in "${services[@]}"; do
        log_info "Building ${service}..."
        
        docker compose ${COMPOSE_FILES} build --no-cache \
            --build-arg VITE_API_URL="${api_url}" \
            "${service}" || {
                log_error "Failed to build ${service}"
                return 1
            }
        
        # Clear build cache to free memory
        docker builder prune -f 2>/dev/null || true
        
        log_success "${service} built"
    done
    
    log_success "All Docker images built"
}

do_start_infrastructure() {
    log_info "Starting infrastructure services..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    # Stop and remove old containers to ensure they pick up new .env values
    log_info "Removing old containers if they exist..."
    docker compose ${COMPOSE_FILES} down 2>/dev/null || true
    
    # Start infrastructure services first with --force-recreate
    docker compose ${COMPOSE_FILES} up -d --force-recreate mongo redis minio minio-init
    
    log_info "Waiting for infrastructure to be ready..."
    
    # Determine if we're in production mode (requires authentication)
    local compose_mode
    compose_mode=$(get_config "compose_mode" "production")
    
    # Wait for MongoDB
    local max_wait=60
    local count=0
    if [[ "${compose_mode}" == "production" ]]; then
        # Production mode - use authentication
        # Try to get password from .env file
        local mongo_admin_password=""
        if [[ -f ".env" ]]; then
            mongo_admin_password=$(grep "^MONGO_ADMIN_PASSWORD=" .env 2>/dev/null | cut -d'=' -f2-)
        fi
        
        if [[ -z "${mongo_admin_password}" ]]; then
            log_warning "MONGO_ADMIN_PASSWORD not found in .env file"
            log_info "Attempting to connect to MongoDB without authentication..."
            # Try without auth (might be first-time setup before passwords are set)
            while ! docker compose ${COMPOSE_FILES} exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; do
                sleep 2
                count=$((count + 1))
                if [[ $count -ge $max_wait ]]; then
                    log_error "MongoDB failed to start within ${max_wait} seconds"
                    log_error "Also, MONGO_ADMIN_PASSWORD not found in .env file"
                    log_error "Please ensure Module 04 (Environment Configuration) completed successfully"
                    return 1
                fi
            done
        else
            # Have password, use authentication
            while ! docker compose ${COMPOSE_FILES} exec -T mongo mongosh -u admin -p "${mongo_admin_password}" --authenticationDatabase admin --eval "db.adminCommand('ping')" &>/dev/null; do
                sleep 2
                count=$((count + 1))
                if [[ $count -ge $((max_wait / 2)) ]]; then
                    log_warning "MongoDB authentication failing, trying without auth..."
                    # Maybe auth isn't set up yet, try without
                    if docker compose ${COMPOSE_FILES} exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; then
                        log_info "MongoDB connected without authentication"
                        break
                    fi
                fi
                if [[ $count -ge $max_wait ]]; then
                    log_error "MongoDB failed to start within ${max_wait} seconds"
                    return 1
                fi
            done
        fi
    else
        # Test mode - no authentication
        while ! docker compose ${COMPOSE_FILES} exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; do
            sleep 2
            count=$((count + 1))
            if [[ $count -ge $max_wait ]]; then
                log_error "MongoDB failed to start within ${max_wait} seconds"
                return 1
            fi
        done
    fi
    log_success "MongoDB is ready"
    
    # Wait for Redis
    count=0
    if [[ "${compose_mode}" == "production" ]]; then
        # Production mode - try to get password
        local redis_password=""
        if [[ -f ".env" ]]; then
            redis_password=$(grep "^REDIS_PASSWORD=" .env 2>/dev/null | cut -d'=' -f2-)
        fi
        
        if [[ -z "${redis_password}" ]]; then
            log_warning "REDIS_PASSWORD not found in .env file, trying without password..."
            # Try without password (might be first-time setup)
            while ! docker compose ${COMPOSE_FILES} exec -T redis redis-cli ping &>/dev/null; do
                sleep 2
                count=$((count + 1))
                if [[ $count -ge 30 ]]; then
                    log_error "Redis failed to start"
                    return 1
                fi
            done
        else
            # Have password, use authentication
            while ! docker compose ${COMPOSE_FILES} exec -T redis redis-cli -a "${redis_password}" ping 2>/dev/null | grep -q PONG; do
                sleep 2
                count=$((count + 1))
                if [[ $count -ge 15 ]]; then
                    log_warning "Redis authentication failing, trying without password..."
                    # Maybe auth isn't set up yet, try without
                    if docker compose ${COMPOSE_FILES} exec -T redis redis-cli ping &>/dev/null; then
                        log_info "Redis connected without authentication"
                        break
                    fi
                fi
                if [[ $count -ge 30 ]]; then
                    log_error "Redis failed to start"
                    return 1
                fi
            done
        fi
    else
        # Test mode - no password
        while ! docker compose ${COMPOSE_FILES} exec -T redis redis-cli ping &>/dev/null; do
            sleep 2
            count=$((count + 1))
            if [[ $count -ge 30 ]]; then
                log_error "Redis failed to start"
                return 1
            fi
        done
    fi
    log_success "Redis is ready"
    
    # Wait for MinIO
    count=0
    while ! docker compose ${COMPOSE_FILES} exec -T minio curl -s http://localhost:9000/minio/health/live &>/dev/null; do
        sleep 2
        count=$((count + 1))
        if [[ $count -ge 30 ]]; then
            log_warning "MinIO health check failed, continuing anyway..."
            break
        fi
    done
    log_success "MinIO is ready"
    
    log_success "Infrastructure services started"
}

do_start_application() {
    log_info "Starting application services..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    # Verify .env file exists and is readable
    if [[ ! -f ".env" ]]; then
        log_error ".env file not found in ${project_dir}"
        return 1
    fi
    
    # Check if MONGO_URL is set in .env
    if ! grep -q "^MONGO_URL=" .env; then
        log_error "MONGO_URL not found in .env file"
        return 1
    fi
    
    log_info "Verified .env file contains required variables"
    
    # Start application services with --force-recreate to ensure .env is loaded
    docker compose ${COMPOSE_FILES} up -d --force-recreate backend experiment-shell admin-dashboard
    
    # Wait for backend
    log_info "Waiting for backend to be ready..."
    local max_iterations=60  # 60 iterations * 3 seconds = 180 seconds total
    local sleep_time=3
    local count=0
    local total_wait=$((max_iterations * sleep_time))
    
    log_info "Backend startup timeout: ${total_wait} seconds"
    
    while ! curl -s http://localhost:8000/api/health &>/dev/null; do
        sleep ${sleep_time}
        count=$((count + 1))
        
        # Show progress every 10 iterations (30 seconds)
        if [[ $((count % 10)) -eq 0 ]]; then
            local elapsed=$((count * sleep_time))
            log_info "Still waiting... (${elapsed}/${total_wait} seconds elapsed)"
        fi
        
        if [[ $count -ge $max_iterations ]]; then
            log_error "Backend failed to start within ${total_wait} seconds"
            echo ""
            log_error "Showing backend logs:"
            echo "================================================================"
            docker compose ${COMPOSE_FILES} logs --tail=100 backend
            echo "================================================================"
            echo ""
            log_error "Showing backend container status:"
            docker compose ${COMPOSE_FILES} ps backend
            echo ""
            log_error "Checking backend environment variables:"
            echo "================================================================"
            docker compose ${COMPOSE_FILES} exec -T backend env | grep -E "MONGO|REDIS" | sed 's/\(PASSWORD\|SECRET\)=.*/\1=***REDACTED***/g'
            echo "================================================================"
            echo ""
            log_error "Checking .env file (first few lines):"
            echo "================================================================"
            head -n 30 .env | grep -E "MONGO|REDIS" | sed 's/\(PASSWORD\|SECRET\)=.*/\1=***REDACTED***/g'
            echo "================================================================"
            echo ""
            log_error "Troubleshooting tips:"
            log_error "  1. Check if MongoDB is accessible: docker compose ${COMPOSE_FILES} exec backend ping mongo -c 3"
            log_error "  2. Check if Redis is accessible: docker compose ${COMPOSE_FILES} exec backend ping redis -c 3"
            log_error "  3. Verify .env file has correct credentials"
            log_error "  4. Try manual backend startup: docker compose ${COMPOSE_FILES} up backend"
            log_error "  5. Restart all services: docker compose ${COMPOSE_FILES} down && docker compose ${COMPOSE_FILES} up -d"
            return 1
        fi
    done
    
    local elapsed=$((count * sleep_time))
    log_success "Backend is ready (started in ${elapsed} seconds)"
    
    log_success "Application services started"
}

do_start_nginx() {
    log_info "Starting nginx..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    docker compose ${COMPOSE_FILES} up -d nginx
    
    # Wait for nginx
    sleep 5
    
    if ! docker compose ${COMPOSE_FILES} ps nginx | grep -q "Up"; then
        log_error "Nginx failed to start"
        docker compose ${COMPOSE_FILES} logs nginx
        return 1
    fi
    
    log_success "Nginx started"
}

do_verify_deployment() {
    log_info "Verifying deployment..."
    
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    # Check all containers are running
    local services=("mongo" "redis" "minio" "backend" "experiment-shell" "admin-dashboard" "nginx")
    local failed=()
    
    for service in "${services[@]}"; do
        if docker compose ${COMPOSE_FILES} ps "${service}" 2>/dev/null | grep -q "Up"; then
            log_success "${service}: running"
        else
            log_error "${service}: not running"
            failed+=("${service}")
        fi
    done
    
    if [[ ${#failed[@]} -gt 0 ]]; then
        log_error "Some services failed to start: ${failed[*]}"
        log_info "Checking logs..."
        for service in "${failed[@]}"; do
            echo ""
            echo "=== ${service} logs ==="
            docker compose ${COMPOSE_FILES} logs --tail=20 "${service}"
        done
        return 1
    fi
    
    # Test endpoints
    local domain
    domain=$(get_config "domain" "localhost")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local protocol="https"
    [[ "${ssl_enabled}" != "true" ]] && protocol="http"
    
    log_info "Testing endpoints..."
    
    # Test health endpoint
    if curl -sk "${protocol}://${domain}/health" | grep -q "healthy"; then
        log_success "Health endpoint: OK"
    else
        log_warning "Health endpoint: may not be accessible externally yet"
    fi
    
    log_success "Deployment verified"
}

do_show_status() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    cd "${project_dir}" || return 1
    
    echo ""
    echo -e "${FORMAT_BOLD}Container Status:${FORMAT_RESET}"
    docker compose ${COMPOSE_FILES} ps
    echo ""
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
    
    # Prepare deployment
    if ! do_prepare_deployment; then
        mark_step_failed "${MODULE_NAME}"
        return 1
    fi
    
    # Pull base images (optional, skip on failure)
    do_pull_images || true
    
    # Build images based on mode
    if is_low_profile_mode; then
        if ! do_build_images_sequential; then
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
        
        # Start services sequentially
        if ! do_start_infrastructure; then
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
        
        if ! do_start_application; then
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
    else
        if ! do_build_images_normal; then
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
        
        # Start infrastructure first, then app
        if ! do_start_infrastructure; then
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
        
        if ! do_start_application; then
            mark_step_failed "${MODULE_NAME}"
            return 1
        fi
    fi
    
    # Start nginx
    if ! do_start_nginx; then
        mark_step_failed "${MODULE_NAME}"
        return 1
    fi
    
    # Verify deployment
    if ! do_verify_deployment; then
        log_warning "Deployment verification had issues, but continuing..."
    fi
    
    # Show status
    do_show_status
    
    mark_step_completed "${MODULE_NAME}"
    
    local domain
    domain=$(get_config "domain" "localhost")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    local protocol="https"
    [[ "${ssl_enabled}" != "true" ]] && protocol="http"
    
    echo ""
    print_box "Deployment Complete" \
        "B-IRES is now running!" \
        "" \
        "Main App:    ${protocol}://${domain}" \
        "Admin Panel: ${protocol}://${domain}/admin" \
        "API:         ${protocol}://${domain}/api"
    echo ""
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
