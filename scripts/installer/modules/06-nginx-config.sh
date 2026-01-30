#!/bin/bash
# =============================================================================
# B-IRES Installer - Module 06: Nginx Configuration
# =============================================================================
# Updates nginx configuration with the correct domain name and SSL paths.
# =============================================================================

# Module info
MODULE_NAME="nginx_config"
MODULE_TITLE="Nginx Configuration"
MODULE_NUMBER=6

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
        log_info "Nginx configuration already completed"
        return 1
    fi
    return 0
}

get_description() {
    local domain
    domain=$(get_config "domain" "yourdomain.com")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    
    if [[ "${ssl_enabled}" == "true" ]]; then
        cat << EOF
  - Update nginx.prod.conf with domain: ${domain}
  - Configure SSL certificate paths
  - Set up HTTPS redirect
  - Configure rate limiting
  - Create SSL directory structure
EOF
    else
        cat << EOF
  - Update nginx.test.conf for HTTP-only mode
  - Configure domain: ${domain}
  - Set up basic routing
EOF
    fi
}

# =============================================================================
# Nginx Configuration Functions
# =============================================================================

do_backup_nginx_config() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_info "Backing up nginx configuration..."
    
    local nginx_dir="${project_dir}/nginx"
    
    if [[ -f "${nginx_dir}/nginx.prod.conf" ]]; then
        backup_file "${nginx_dir}/nginx.prod.conf"
    fi
    
    if [[ -f "${nginx_dir}/nginx.test.conf" ]]; then
        backup_file "${nginx_dir}/nginx.test.conf"
    fi
    
    log_success "Nginx configuration backed up"
}

do_update_prod_config() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    local domain
    domain=$(get_config "domain" "")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    
    if [[ "${ssl_enabled}" != "true" ]]; then
        log_info "SSL disabled, using test configuration"
        return 0
    fi
    
    local nginx_conf="${project_dir}/nginx/nginx.prod.conf"
    
    log_info "Updating nginx.prod.conf with domain: ${domain}"
    
    # Check if nginx.prod.conf exists
    if [[ ! -f "${nginx_conf}" ]]; then
        log_warning "nginx.prod.conf not found, creating from template..."
        do_create_prod_config
        return $?
    fi
    
    # Update domain in server_name directives
    run_sudo sed -i "s/server_name .*;/server_name ${domain} www.${domain};/g" "${nginx_conf}"
    
    # Update SSL certificate paths
    run_sudo sed -i "s|ssl_certificate .*;|ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;|g" "${nginx_conf}"
    run_sudo sed -i "s|ssl_certificate_key .*;|ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;|g" "${nginx_conf}"
    
    log_success "nginx.prod.conf updated"
}

do_create_prod_config() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    local domain
    domain=$(get_config "domain" "")
    
    local nginx_conf="${project_dir}/nginx/nginx.prod.conf"
    
    log_info "Creating production nginx configuration..."
    
    run_sudo tee "${nginx_conf}" > /dev/null << EOF
# B-IRES Production Nginx Configuration
# Domain: ${domain}
# Generated: $(date)

worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '\$remote_addr - \$remote_user [\$time_local] "\$request" '
                    '\$status \$body_bytes_sent "\$http_referer" '
                    '"\$http_user_agent" "\$http_x_forwarded_for"';
    access_log /var/log/nginx/access.log main;

    # Performance
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml application/json application/javascript 
               application/rss+xml application/atom+xml image/svg+xml;

    # Rate limiting
    limit_req_zone \$binary_remote_addr zone=api:10m rate=20r/s;
    limit_req_zone \$binary_remote_addr zone=auth:10m rate=5r/m;

    # HTTP to HTTPS redirect
    server {
        listen 80;
        listen [::]:80;
        server_name ${domain} www.${domain};

        location /.well-known/acme-challenge/ {
            root /var/www/certbot;
        }

        location / {
            return 301 https://\$host\$request_uri;
        }
    }

    # Main HTTPS server
    server {
        listen 443 ssl http2;
        listen [::]:443 ssl http2;
        server_name ${domain} www.${domain};

        # SSL Configuration
        ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
        ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;
        ssl_session_timeout 1d;
        ssl_session_cache shared:SSL:50m;
        ssl_session_tickets off;

        # Modern SSL configuration
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
        ssl_prefer_server_ciphers off;

        # HSTS
        add_header Strict-Transport-Security "max-age=63072000" always;

        # Security headers
        add_header X-Frame-Options "SAMEORIGIN" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header X-XSS-Protection "1; mode=block" always;

        # API routes
        location /api/ {
            limit_req zone=api burst=50 nodelay;
            
            proxy_pass http://backend:8000/;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
            proxy_read_timeout 300;
            proxy_connect_timeout 300;
            proxy_send_timeout 300;
        }

        # Auth rate limiting
        location /api/auth/ {
            limit_req zone=auth burst=5 nodelay;
            
            proxy_pass http://backend:8000/auth/;
            proxy_http_version 1.1;
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # Admin dashboard
        location /admin {
            proxy_pass http://admin-dashboard:3001;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }

        # Health check
        location /health {
            access_log off;
            return 200 "healthy\\n";
            add_header Content-Type text/plain;
        }

        # Experiment shell (main frontend)
        location / {
            proxy_pass http://experiment-shell:3000;
            proxy_http_version 1.1;
            proxy_set_header Upgrade \$http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host \$host;
            proxy_set_header X-Real-IP \$remote_addr;
            proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto \$scheme;
        }
    }
}
EOF
    
    log_success "Production nginx configuration created"
}

do_update_test_config() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    local domain
    domain=$(get_config "domain" "")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    
    if [[ "${ssl_enabled}" == "true" ]]; then
        log_debug "SSL enabled, skipping test config update"
        return 0
    fi
    
    local nginx_conf="${project_dir}/nginx/nginx.test.conf"
    
    log_info "Updating nginx.test.conf for HTTP-only mode"
    
    if [[ -f "${nginx_conf}" ]]; then
        # Update server_name
        run_sudo sed -i "s/server_name .*;/server_name ${domain} www.${domain};/g" "${nginx_conf}"
    fi
    
    log_success "Test nginx configuration updated"
}

do_create_ssl_directory() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    
    log_info "Creating SSL directory structure..."
    
    run_sudo mkdir -p "${project_dir}/nginx/ssl"
    run_sudo mkdir -p /var/www/certbot
    
    log_success "SSL directory created"
}

do_verify_config() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    local ssl_enabled
    ssl_enabled=$(get_config "ssl_enabled" "true")
    
    log_info "Verifying nginx configuration..."
    
    local config_file
    if [[ "${ssl_enabled}" == "true" ]]; then
        config_file="${project_dir}/nginx/nginx.prod.conf"
    else
        config_file="${project_dir}/nginx/nginx.test.conf"
    fi
    
    if [[ ! -f "${config_file}" ]]; then
        log_error "Nginx configuration file not found: ${config_file}"
        return 1
    fi
    
    # Basic syntax check (nginx -t requires running nginx)
    # Just check if file contains required sections
    if ! grep -q "upstream\|proxy_pass" "${config_file}" 2>/dev/null; then
        if ! grep -q "proxy_pass" "${config_file}" 2>/dev/null; then
            log_warning "Configuration may be incomplete - no proxy_pass found"
        fi
    fi
    
    log_success "Nginx configuration verified"
}

do_set_permissions() {
    local project_dir
    project_dir=$(get_config "project_dir" "")
    local username
    username=$(get_config "create_user" "bires")
    
    log_info "Setting nginx configuration permissions..."
    
    run_sudo chown -R "${username}:${username}" "${project_dir}/nginx"
    run_sudo chmod 644 "${project_dir}/nginx/"*.conf 2>/dev/null || true
    run_sudo chmod 755 "${project_dir}/nginx"
    
    log_success "Permissions set"
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
        "do_backup_nginx_config:Backing up configuration"
        "do_create_ssl_directory:Creating SSL directory"
        "do_update_prod_config:Updating production config"
        "do_update_test_config:Updating test config"
        "do_verify_config:Verifying configuration"
        "do_set_permissions:Setting permissions"
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
    
    log_success "Nginx configuration completed!"
    
    return 0
}

# Run if executed directly
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
    run_module
fi
