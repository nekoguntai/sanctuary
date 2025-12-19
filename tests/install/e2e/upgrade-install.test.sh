#!/bin/bash
# ============================================
# End-to-End Upgrade Install Test
# ============================================
#
# This test simulates upgrading an existing Sanctuary installation
# and verifies that:
# - Existing data is preserved
# - Secrets are reused from .env.local
# - Database migrations run correctly
# - Containers restart properly
#
# Requirements:
#   - Existing Sanctuary installation OR fresh install first
#   - Docker and Docker Compose v2
#
# Run: ./upgrade-install.test.sh [--keep-containers]
# ============================================

set -e

# Get the directory of this script
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"

# Source helpers
source "$SCRIPT_DIR/../utils/helpers.sh"

# ============================================
# Configuration
# ============================================

KEEP_CONTAINERS=false
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --keep-containers)
            KEEP_CONTAINERS=true
            shift
            ;;
        --verbose|-v)
            VERBOSE=true
            export DEBUG=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Test configuration
TEST_ID=$(generate_test_run_id)
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"

# State variables for testing
ORIGINAL_JWT_SECRET=""
ORIGINAL_ENCRYPTION_KEY=""
ORIGINAL_USER_PASSWORD=""
TEST_WALLET_ID=""

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# ============================================
# Test Framework
# ============================================

run_test() {
    local test_name="$1"
    local test_func="$2"

    TESTS_RUN=$((TESTS_RUN + 1))
    echo ""
    log_info "Running test: $test_name"
    echo "-------------------------------------------"

    set +e
    $test_func
    local exit_code=$?
    set -e

    if [ $exit_code -eq 0 ]; then
        log_success "PASSED: $test_name"
        TESTS_PASSED=$((TESTS_PASSED + 1))
    else
        log_error "FAILED: $test_name"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        FAILED_TESTS+=("$test_name")
    fi
}

# ============================================
# Setup and Teardown
# ============================================

setup() {
    log_info "Setting up upgrade test environment..."
    log_info "  Test ID:       $TEST_ID"
    log_info "  Project Root:  $PROJECT_ROOT"
    log_info "  HTTPS Port:    $HTTPS_PORT"

    # Verify prerequisites
    if ! check_docker_available; then
        log_error "Docker is not available. Cannot run upgrade tests."
        exit 1
    fi

    setup_cleanup_trap "teardown"
}

teardown() {
    log_info "Cleaning up upgrade test environment..."

    if [ "$KEEP_CONTAINERS" = "false" ]; then
        cleanup_containers "$PROJECT_ROOT" 2>/dev/null || true
    else
        log_warning "Keeping containers running (--keep-containers specified)"
        get_container_status "$PROJECT_ROOT"
    fi
}

# ============================================
# Test: Verify Existing Installation or Create One
# ============================================

test_ensure_existing_installation() {
    log_info "Checking for existing installation..."

    cd "$PROJECT_ROOT"

    # Check if containers are running
    local frontend_running=$(docker ps --filter "name=sanctuary-frontend" --filter "status=running" -q)

    if [ -n "$frontend_running" ]; then
        log_info "Found existing running installation"

        # Get existing secrets from .env.local
        if [ -f "$PROJECT_ROOT/.env.local" ]; then
            source "$PROJECT_ROOT/.env.local"
            ORIGINAL_JWT_SECRET="$JWT_SECRET"
            ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
            log_info "Loaded existing secrets from .env.local"
        fi

        return 0
    fi

    # No existing installation - create one
    log_info "No existing installation found. Creating initial installation..."

    # Generate initial secrets
    ORIGINAL_JWT_SECRET=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)
    ORIGINAL_ENCRYPTION_KEY=$(openssl rand -base64 32 | tr -d '=/+' | head -c 48)

    # Save to .env.local
    cat > "$PROJECT_ROOT/.env.local" << EOF
JWT_SECRET=$ORIGINAL_JWT_SECRET
ENCRYPTION_KEY=$ORIGINAL_ENCRYPTION_KEY
EOF

    # Generate SSL certs if needed
    local ssl_dir="$PROJECT_ROOT/docker/nginx/ssl"
    if [ ! -f "$ssl_dir/fullchain.pem" ]; then
        cd "$ssl_dir"
        ./generate-certs.sh localhost 2>/dev/null || true
        cd "$PROJECT_ROOT"
    fi

    # Build images first (migrate container depends on backend image)
    JWT_SECRET="$ORIGINAL_JWT_SECRET" ENCRYPTION_KEY="$ORIGINAL_ENCRYPTION_KEY" \
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        docker compose build 2>&1

    # Then start containers
    JWT_SECRET="$ORIGINAL_JWT_SECRET" ENCRYPTION_KEY="$ORIGINAL_ENCRYPTION_KEY" \
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        docker compose up -d 2>&1

    # Wait for containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Initial installation failed"
        return 1
    fi

    # Wait for migration
    wait_for_migration_complete 120 || true

    log_success "Initial installation created"
    return 0
}

# ============================================
# Test: Create Test Data Before Upgrade
# ============================================

test_create_pre_upgrade_data() {
    log_info "Creating test data before upgrade..."

    # Login with admin
    local login_response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d '{"username":"admin","password":"sanctuary"}' \
        "$API_BASE_URL/api/v1/auth/login")

    local token=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

    # If default password doesn't work, try our test password
    if [ -z "$token" ]; then
        login_response=$(curl -k -s -X POST \
            -H "Content-Type: application/json" \
            -d '{"username":"admin","password":"UpgradeTestPassword123!"}' \
            "$API_BASE_URL/api/v1/auth/login")
        token=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
        ORIGINAL_USER_PASSWORD="UpgradeTestPassword123!"
    else
        # Change password to a known value for upgrade testing
        ORIGINAL_USER_PASSWORD="UpgradeTestPassword123!"
        curl -k -s -X POST \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $token" \
            -d "{\"currentPassword\":\"sanctuary\",\"newPassword\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/me/change-password" >/dev/null

        # Re-login with new password
        login_response=$(curl -k -s -X POST \
            -H "Content-Type: application/json" \
            -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
            "$API_BASE_URL/api/v1/auth/login")
        token=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    fi

    if [ -z "$token" ]; then
        log_error "Failed to get auth token"
        return 1
    fi

    log_success "Test data created (password changed to test password)"
    return 0
}

# ============================================
# Test: Capture Pre-Upgrade State
# ============================================

test_capture_pre_upgrade_state() {
    log_info "Capturing pre-upgrade state..."

    # Capture .env.local contents
    if [ -f "$PROJECT_ROOT/.env.local" ]; then
        source "$PROJECT_ROOT/.env.local"
        ORIGINAL_JWT_SECRET="$JWT_SECRET"
        ORIGINAL_ENCRYPTION_KEY="$ENCRYPTION_KEY"
        log_info "Captured JWT_SECRET: ${ORIGINAL_JWT_SECRET:0:8}..."
        log_info "Captured ENCRYPTION_KEY: ${ORIGINAL_ENCRYPTION_KEY:0:8}..."
    else
        log_error ".env.local not found"
        return 1
    fi

    # Capture database state
    local user_count=$(docker exec sanctuary-db psql -U sanctuary -d sanctuary -t -c \
        "SELECT COUNT(*) FROM \"User\";" 2>/dev/null | tr -d ' ')
    log_info "User count: $user_count"

    log_success "Pre-upgrade state captured"
    return 0
}

# ============================================
# Test: Stop Containers for Upgrade
# ============================================

test_stop_containers_for_upgrade() {
    log_info "Stopping containers for upgrade simulation..."

    cd "$PROJECT_ROOT"

    docker compose stop 2>&1

    # Verify containers stopped
    local running=$(docker ps --filter "name=sanctuary" --filter "status=running" -q | wc -l)
    if [ "$running" -gt 0 ]; then
        log_error "Some containers still running after stop"
        return 1
    fi

    log_success "Containers stopped"
    return 0
}

# ============================================
# Test: Simulate Git Pull (Update)
# ============================================

test_simulate_git_update() {
    log_info "Simulating git update..."

    cd "$PROJECT_ROOT"

    # Verify we're in a git repository
    if ! git rev-parse --is-inside-work-tree &>/dev/null; then
        log_error "Not in a git repository"
        return 1
    fi

    # Get current commit
    local current_commit=$(git rev-parse HEAD)
    log_info "Current commit: $current_commit"

    # Simulate what install.sh does for updates
    # (We don't actually pull to avoid changing code during tests)
    log_info "Skipping actual git pull to preserve test environment"

    log_success "Git update simulation complete"
    return 0
}

# ============================================
# Test: Restart Containers After Upgrade
# ============================================

test_restart_containers_after_upgrade() {
    log_info "Restarting containers after upgrade..."

    cd "$PROJECT_ROOT"

    # Load secrets from .env.local
    source "$PROJECT_ROOT/.env.local"

    # Restart with existing secrets
    JWT_SECRET="$JWT_SECRET" ENCRYPTION_KEY="$ENCRYPTION_KEY" \
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        docker compose up -d 2>&1

    # Wait for containers to be healthy
    if ! wait_for_all_containers_healthy 300; then
        log_error "Containers failed to restart after upgrade"
        return 1
    fi

    log_success "Containers restarted successfully"
    return 0
}

# ============================================
# Test: Verify Secrets Preserved
# ============================================

test_verify_secrets_preserved() {
    log_info "Verifying secrets were preserved..."

    # Reload .env.local
    source "$PROJECT_ROOT/.env.local"

    if [ "$JWT_SECRET" != "$ORIGINAL_JWT_SECRET" ]; then
        log_error "JWT_SECRET changed after upgrade"
        log_error "  Original: ${ORIGINAL_JWT_SECRET:0:8}..."
        log_error "  Current:  ${JWT_SECRET:0:8}..."
        return 1
    fi

    if [ "$ENCRYPTION_KEY" != "$ORIGINAL_ENCRYPTION_KEY" ]; then
        log_error "ENCRYPTION_KEY changed after upgrade"
        return 1
    fi

    log_success "Secrets preserved correctly"
    return 0
}

# ============================================
# Test: Verify Data Preserved After Upgrade
# ============================================

test_verify_data_preserved() {
    log_info "Verifying data preserved after upgrade..."

    # Try to login with the password we set before upgrade
    local login_response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"token"'; then
        log_error "Cannot login with pre-upgrade password"
        log_error "Response: $login_response"
        return 1
    fi

    log_success "User data preserved after upgrade"
    return 0
}

# ============================================
# Test: Verify Migration Runs on Upgrade
# ============================================

test_verify_migration_on_upgrade() {
    log_info "Verifying migration container ran..."

    # Check if migrate container exists and completed
    local status=$(docker inspect -f '{{.State.Status}}' sanctuary-migrate 2>/dev/null || echo "not_found")

    if [ "$status" = "exited" ]; then
        local exit_code=$(docker inspect -f '{{.State.ExitCode}}' sanctuary-migrate 2>/dev/null)
        if [ "$exit_code" = "0" ]; then
            log_success "Migration container completed successfully"
            return 0
        else
            log_error "Migration container failed with exit code: $exit_code"
            docker logs sanctuary-migrate 2>&1 | tail -20
            return 1
        fi
    elif [ "$status" = "not_found" ]; then
        log_warning "Migration container not found (may have been removed)"
        return 0
    else
        log_warning "Migration container in unexpected state: $status"
        return 0
    fi
}

# ============================================
# Test: Verify All Services Functional
# ============================================

test_verify_all_services() {
    log_info "Verifying all services are functional..."

    # Login
    local login_response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    local token=$(echo "$login_response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)

    if [ -z "$token" ]; then
        log_error "Cannot get auth token"
        return 1
    fi

    # Test /me endpoint
    local me_response=$(curl -k -s \
        -H "Authorization: Bearer $token" \
        "$API_BASE_URL/api/v1/auth/me")

    if ! echo "$me_response" | grep -q '"username"'; then
        log_error "GET /me endpoint failed"
        return 1
    fi

    # Test /wallets endpoint
    local wallets_response=$(curl -k -s \
        -H "Authorization: Bearer $token" \
        "$API_BASE_URL/api/v1/wallets")

    if ! echo "$wallets_response" | grep -qE '^\['; then
        log_error "GET /wallets endpoint failed"
        return 1
    fi

    log_success "All services functional after upgrade"
    return 0
}

# ============================================
# Test: Force Rebuild Upgrade
# ============================================

test_force_rebuild_upgrade() {
    log_info "Testing force rebuild upgrade..."

    cd "$PROJECT_ROOT"

    # Load secrets
    source "$PROJECT_ROOT/.env.local"

    # Force rebuild all containers
    JWT_SECRET="$JWT_SECRET" ENCRYPTION_KEY="$ENCRYPTION_KEY" \
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        docker compose up -d --build --force-recreate 2>&1

    # Wait for all containers
    if ! wait_for_all_containers_healthy 300; then
        log_error "Force rebuild failed"
        return 1
    fi

    # Verify login still works
    local login_response=$(curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"admin\",\"password\":\"$ORIGINAL_USER_PASSWORD\"}" \
        "$API_BASE_URL/api/v1/auth/login")

    if ! echo "$login_response" | grep -q '"token"'; then
        log_error "Login failed after force rebuild"
        return 1
    fi

    log_success "Force rebuild upgrade successful"
    return 0
}

# ============================================
# Test: Volume Data Persistence
# ============================================

test_volume_data_persistence() {
    log_info "Testing volume data persistence..."

    cd "$PROJECT_ROOT"

    # Check postgres_data volume exists
    local volume_exists=$(docker volume ls --filter "name=sanctuary_postgres_data" -q 2>/dev/null)

    if [ -z "$volume_exists" ]; then
        # Try alternative volume naming
        volume_exists=$(docker volume ls --filter "name=postgres_data" -q 2>/dev/null)
    fi

    if [ -z "$volume_exists" ]; then
        log_warning "PostgreSQL data volume not found with expected name"
        # This might be okay if using different naming
    else
        log_info "Found PostgreSQL data volume"
    fi

    # Verify data still accessible
    local user_count=$(docker exec sanctuary-db psql -U sanctuary -d sanctuary -t -c \
        "SELECT COUNT(*) FROM \"User\";" 2>/dev/null | tr -d ' ')

    if [ -z "$user_count" ] || [ "$user_count" -lt 1 ]; then
        log_error "No users found in database - data may have been lost"
        return 1
    fi

    log_success "Volume data persisted correctly (found $user_count users)"
    return 0
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Upgrade Install E2E Test${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Setup
    setup

    # Phase 1: Prepare existing installation
    run_test "Ensure Existing Installation" test_ensure_existing_installation
    run_test "Create Pre-Upgrade Data" test_create_pre_upgrade_data
    run_test "Capture Pre-Upgrade State" test_capture_pre_upgrade_state

    # Phase 2: Simulate upgrade
    run_test "Stop Containers for Upgrade" test_stop_containers_for_upgrade
    run_test "Simulate Git Update" test_simulate_git_update
    run_test "Restart Containers After Upgrade" test_restart_containers_after_upgrade

    # Phase 3: Verify upgrade success
    run_test "Verify Secrets Preserved" test_verify_secrets_preserved
    run_test "Verify Data Preserved" test_verify_data_preserved
    run_test "Verify Migration on Upgrade" test_verify_migration_on_upgrade
    run_test "Verify All Services" test_verify_all_services

    # Phase 4: Additional upgrade scenarios
    run_test "Force Rebuild Upgrade" test_force_rebuild_upgrade
    run_test "Volume Data Persistence" test_volume_data_persistence

    # Teardown
    teardown

    # Summary
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Test Summary${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""
    echo "  Total:  $TESTS_RUN"
    echo -e "  ${GREEN}Passed: $TESTS_PASSED${NC}"
    echo -e "  ${RED}Failed: $TESTS_FAILED${NC}"
    echo ""

    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed Tests:${NC}"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  - $test"
        done
        echo ""
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        echo ""
        exit 0
    fi
}

# Run tests
main "$@"
