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
        return 1
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
    
    # Start infrastructure services first
    docker compose ${COMPOSE_FILES} up -d mongo redis minio minio-init
    
    log_info "Waiting for infrastructure to be ready..."
    
    # Wait for MongoDB
    local max_wait=60
    local count=0
    while ! docker compose ${COMPOSE_FILES} exec -T mongo mongosh --eval "db.adminCommand('ping')" &>/dev/null; do
        sleep 2
        count=$((count + 1))
        if [[ $count -ge $max_wait ]]; then
            log_error "MongoDB failed to start within ${max_wait} seconds"
            return 1
        fi
    done
    log_success "MongoDB is ready"
    
    # Wait for Redis
    count=0
    while ! docker compose ${COMPOSE_FILES} exec -T redis redis-cli ping &>/dev/null; do
        sleep 2
        count=$((count + 1))
        if [[ $count -ge 30 ]]; then
            log_error "Redis failed to start"
            return 1
        fi
    done
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
    
    # Start application services
    docker compose ${COMPOSE_FILES} up -d backend experiment-shell admin-dashboard
    
    # Wait for backend
    log_info "Waiting for backend to be ready..."
    local max_wait=120
    local count=0
    while ! curl -s http://localhost:8000/health &>/dev/null; do
        sleep 3
        count=$((count + 1))
        if [[ $count -ge $max_wait ]]; then
            log_error "Backend failed to start within ${max_wait} seconds"
            docker compose ${COMPOSE_FILES} logs backend
            return 1
        fi
    done
    log_success "Backend is ready"
    
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
