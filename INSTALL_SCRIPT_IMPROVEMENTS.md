# Installation Script Improvements

## Date: 2026-01-31

## Problem Summary

The installation script had an issue where nginx would fail to start with the error:
```
nginx: [emerg] cannot load certificate "/etc/letsencrypt/live/yourdomain.com/fullchain.pem"
```

This happened because:
1. The nginx production config had a hardcoded `yourdomain.com` domain
2. Module 06 (Nginx Configuration) didn't properly replace this placeholder with the actual domain
3. There was a deprecated nginx syntax `listen 443 ssl http2` causing warnings

## Changes Made

### 1. nginx/nginx.prod.conf
**Changes:**
- Replaced hardcoded `yourdomain.com` with `DOMAIN_PLACEHOLDER` (easier to detect and replace)
- Fixed deprecated http2 syntax:
  - **Before:** `listen 443 ssl http2;`
  - **After:** `listen 443 ssl;` with `http2 on;` directive
- This makes the template more maintainable and eliminates nginx warnings

**Why:** Using a clear placeholder makes it obvious when the domain hasn't been configured, and the new http2 syntax is the correct way to enable HTTP/2 in modern nginx versions.

### 2. scripts/installer/modules/06-nginx-config.sh
**Changes:**
- Added domain validation at the start of `do_update_prod_config()` and `do_create_prod_config()`
- Enhanced sed replacement patterns to handle `DOMAIN_PLACEHOLDER`
- Added comprehensive prerequisite checks in `run_module()`:
  - Verifies project directory exists
  - Verifies domain is configured
  - Provides clear error messages pointing to previous modules if prerequisites aren't met
- Enhanced `do_verify_config()` to check for unreplaced placeholders
- Updated `do_create_prod_config()` template to use new http2 syntax

**Why:** These checks ensure the module fails fast with clear error messages if prerequisites aren't met, making it easier to debug installation issues.

### 3. scripts/installer/modules/07-deploy-app.sh
**Changes:**
- Enhanced `do_start_nginx()` with pre-flight SSL certificate checks
- Added detailed error messages when nginx fails to start:
  - Checks if SSL certificate exists before starting nginx
  - Detects SSL certificate errors in nginx logs
  - Provides actionable troubleshooting steps
- Added prerequisite checks in `run_module()` to verify Modules 04 and 06 completed
- Better error context with domain-specific paths

**Why:** These enhancements provide much better diagnostics when nginx fails to start, guiding users to the exact problem and solution.

## Installation Flow

The corrected installation flow now ensures:

1. **Module 03** - Clone Project: Sets up the project directory
2. **Module 04** - Configure Environment: Collects and saves the domain name
3. **Module 05** - SSL Setup: Obtains SSL certificates for the domain (if enabled)
4. **Module 06** - Nginx Config: Updates nginx config with the actual domain
   - Validates domain is configured
   - Replaces `DOMAIN_PLACEHOLDER` with actual domain
   - Verifies no placeholders remain
5. **Module 07** - Deploy App: Starts all services including nginx
   - Checks SSL certificate exists before starting nginx (production mode)
   - Provides detailed error messages if nginx fails

## Validation Added

### Module 06 (Nginx Configuration)
- ✅ Validates domain is not empty before proceeding
- ✅ Validates project directory exists
- ✅ Checks for unreplaced placeholders in config
- ✅ Verifies domain appears in final config

### Module 07 (Deployment)
- ✅ Checks if SSL certificate exists before starting nginx (production)
- ✅ Provides specific error messages for SSL certificate issues
- ✅ Shows nginx logs when startup fails
- ✅ Warns if prerequisite modules haven't completed

## Testing Recommendations

After these changes, test the following scenarios:

### Scenario 1: Fresh Installation with SSL
```bash
# Create config with domain
echo "DOMAIN=test-domain.com" > config.txt
echo "SETUP_SSL=yes" >> config.txt
echo "SSL_EMAIL=admin@test-domain.com" >> config.txt

# Run installer
sudo bash scripts/install.sh --config config.txt
```

Expected: Module 06 should replace DOMAIN_PLACEHOLDER with test-domain.com

### Scenario 2: Fresh Installation without SSL
```bash
# Create config without SSL
echo "DOMAIN=test-domain.com" > config.txt
echo "SETUP_SSL=no" >> config.txt

# Run installer
sudo bash scripts/install.sh --config config.txt
```

Expected: Should use nginx.test.conf (HTTP only), no SSL certificate checks

### Scenario 3: Missing Domain
```bash
# Create config without domain
echo "SETUP_SSL=no" > config.txt

# Run installer (interactive)
sudo bash scripts/install.sh --config config.txt
```

Expected: Module 04 should prompt for domain (interactive) or Module 06 should fail with clear error (non-interactive)

## Benefits

1. **Clear Error Messages**: Users know exactly what went wrong and how to fix it
2. **Fail Fast**: Issues are caught early with helpful guidance
3. **Better Debugging**: Enhanced logging shows SSL certificate paths, domain configuration
4. **Future-Proof**: Using `DOMAIN_PLACEHOLDER` makes it clear when config isn't properly set up
5. **Standards Compliant**: Fixed deprecated nginx syntax
6. **Maintainable**: Clear validation at each step makes the installation process more robust

## Files Modified

- `nginx/nginx.prod.conf` - Updated template with placeholder and modern syntax
- `scripts/installer/modules/06-nginx-config.sh` - Enhanced validation and error handling
- `scripts/installer/modules/07-deploy-app.sh` - Added pre-flight checks and better diagnostics

## Migration Notes

For existing installations that may have the old `yourdomain.com` in their nginx config, the enhanced Module 06 will now properly replace it with the actual domain when re-run. The sed patterns now handle:
- `DOMAIN_PLACEHOLDER`
- `yourdomain.com`
- `server_name _;`
- Any other domain in SSL certificate paths

## Future Improvements

Consider adding:
1. Dry-run mode to validate configuration before deployment
2. Health check script to verify all services are running correctly
3. Rollback capability if deployment fails
4. Certificate expiry warnings
5. Automated certificate renewal testing
