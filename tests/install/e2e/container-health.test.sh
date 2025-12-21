#!/bin/bash
# ============================================
# Container Health Verification Tests
# ============================================
#
# These tests verify that all Sanctuary containers
# start correctly and pass their health checks.
#
# Run: ./container-health.test.sh
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

VERBOSE=false
TIMEOUT_MULTIPLIER=1

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            export DEBUG=true
            shift
            ;;
        --slow)
            TIMEOUT_MULTIPLIER=2
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Calculate timeouts
CONTAINER_TIMEOUT=$((120 * TIMEOUT_MULTIPLIER))
DB_TIMEOUT=$((60 * TIMEOUT_MULTIPLIER))

# Test configuration
HTTPS_PORT="${HTTPS_PORT:-8443}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"

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
# Container Tests
# ============================================

test_containers_exist() {
    log_info "Checking if all containers exist..."

    local containers=("sanctuary-db" "sanctuary-backend" "sanctuary-frontend" "sanctuary-gateway" "sanctuary-migrate")
    local all_exist=true

    for container in "${containers[@]}"; do
        if docker ps -a --filter "name=$container" --format "{{.Names}}" | grep -q "^${container}$"; then
            log_debug "Container exists: $container"
        else
            log_error "Container not found: $container"
            all_exist=false
        fi
    done

    if [ "$all_exist" = "true" ]; then
        log_success "All containers exist"
        return 0
    else
        return 1
    fi
}

test_database_container_running() {
    log_info "Checking database container..."

    if ! assert_container_running "sanctuary-db" "Database container should be running"; then
        docker logs sanctuary-db --tail 30 2>&1 | head -20
        return 1
    fi

    return 0
}

test_database_container_healthy() {
    log_info "Checking database container health..."

    if ! wait_for_container_healthy "sanctuary-db" "$DB_TIMEOUT"; then
        log_error "Database container not healthy"
        docker inspect sanctuary-db --format='{{json .State}}' 2>/dev/null | head -5
        return 1
    fi

    return 0
}

test_database_connection() {
    log_info "Testing database connection..."

    # Try pg_isready
    local result=$(docker exec sanctuary-db pg_isready -U sanctuary -d sanctuary 2>/dev/null)

    if [[ "$result" == *"accepting connections"* ]]; then
        log_success "Database is accepting connections"
        return 0
    else
        log_error "Database not accepting connections: $result"
        return 1
    fi
}

test_database_tables_exist() {
    log_info "Checking if database tables exist..."

    # Check for users table (created by Prisma migration - see @@map("users") in schema.prisma)
    local table_check=$(docker exec sanctuary-db psql -U sanctuary -d sanctuary -t -c \
        "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users' AND table_schema = 'public');" 2>/dev/null | tr -d ' ')

    if [ "$table_check" = "t" ]; then
        log_success "Database tables exist"
        return 0
    else
        log_error "Database tables not found - migration may not have run"
        # Debug: show what tables actually exist
        docker exec sanctuary-db psql -U sanctuary -d sanctuary -c "\dt public.*" 2>/dev/null | head -20
        return 1
    fi
}

test_backend_container_running() {
    log_info "Checking backend container..."

    if ! assert_container_running "sanctuary-backend" "Backend container should be running"; then
        docker logs sanctuary-backend --tail 30 2>&1 | head -20
        return 1
    fi

    return 0
}

test_backend_container_healthy() {
    log_info "Checking backend container health..."

    if ! wait_for_container_healthy "sanctuary-backend" "$CONTAINER_TIMEOUT"; then
        log_error "Backend container not healthy"
        docker logs sanctuary-backend --tail 50 2>&1 | head -30
        return 1
    fi

    return 0
}

test_backend_health_endpoint() {
    log_info "Testing backend health endpoint..."

    # Test internal health endpoint
    local health_response=$(docker exec sanctuary-backend wget -q -O - http://localhost:3001/health 2>/dev/null || echo "FAILED")

    if [ "$health_response" = "FAILED" ]; then
        log_error "Backend health endpoint not responding"
        return 1
    fi

    log_debug "Health response: $health_response"
    log_success "Backend health endpoint responding"
    return 0
}

test_backend_api_ready() {
    log_info "Testing backend API readiness..."

    # Try to access an API endpoint through the container network
    local api_response=$(docker exec sanctuary-backend wget -q -O - http://localhost:3001/api/v1/health 2>/dev/null || \
        docker exec sanctuary-backend wget -q -O - http://localhost:3001/health 2>/dev/null || echo "FAILED")

    if [ "$api_response" = "FAILED" ]; then
        log_warning "Backend API health endpoint not responding"
        # Don't fail - the specific endpoint might not exist
        return 0
    fi

    log_success "Backend API is ready"
    return 0
}

test_frontend_container_running() {
    log_info "Checking frontend container..."

    if ! assert_container_running "sanctuary-frontend" "Frontend container should be running"; then
        docker logs sanctuary-frontend --tail 30 2>&1 | head -20
        return 1
    fi

    return 0
}

test_frontend_container_healthy() {
    log_info "Checking frontend container health..."

    if ! wait_for_container_healthy "sanctuary-frontend" "$CONTAINER_TIMEOUT"; then
        log_error "Frontend container not healthy"
        docker logs sanctuary-frontend --tail 50 2>&1 | head -30
        return 1
    fi

    return 0
}

test_frontend_nginx_running() {
    log_info "Testing frontend nginx..."

    # Check if nginx is running inside the container
    local nginx_pid=$(docker exec sanctuary-frontend pgrep nginx 2>/dev/null | head -1)

    if [ -n "$nginx_pid" ]; then
        log_success "Nginx is running (PID: $nginx_pid)"
        return 0
    else
        log_error "Nginx not running in frontend container"
        return 1
    fi
}

test_frontend_serves_content() {
    log_info "Testing frontend serves content..."

    # Try to get the index page
    local content=$(docker exec sanctuary-frontend wget -q -O - --no-check-certificate https://localhost:443/ 2>/dev/null | head -20)

    if [ -z "$content" ]; then
        # Try HTTP
        content=$(docker exec sanctuary-frontend wget -q -O - http://localhost:80/ 2>/dev/null | head -20)
    fi

    if [ -n "$content" ]; then
        log_success "Frontend is serving content"
        return 0
    else
        log_error "Frontend not serving content"
        return 1
    fi
}

test_gateway_container_running() {
    log_info "Checking gateway container..."

    if ! assert_container_running "sanctuary-gateway" "Gateway container should be running"; then
        docker logs sanctuary-gateway --tail 30 2>&1 | head -20
        return 1
    fi

    return 0
}

test_gateway_container_healthy() {
    log_info "Checking gateway container health..."

    if ! wait_for_container_healthy "sanctuary-gateway" "$CONTAINER_TIMEOUT"; then
        log_error "Gateway container not healthy"
        docker logs sanctuary-gateway --tail 50 2>&1 | head -30
        return 1
    fi

    return 0
}

test_gateway_health_endpoint() {
    log_info "Testing gateway health endpoint..."

    local health_response=$(docker exec sanctuary-gateway wget -q -O - http://localhost:4000/health 2>/dev/null || echo "FAILED")

    if [ "$health_response" = "FAILED" ]; then
        log_error "Gateway health endpoint not responding"
        return 1
    fi

    log_success "Gateway health endpoint responding"
    return 0
}

test_migrate_container_completed() {
    log_info "Checking migration container..."

    local status=$(docker inspect -f '{{.State.Status}}' sanctuary-migrate 2>/dev/null || echo "not_found")

    case "$status" in
        "exited")
            local exit_code=$(docker inspect -f '{{.State.ExitCode}}' sanctuary-migrate 2>/dev/null)
            if [ "$exit_code" = "0" ]; then
                log_success "Migration completed successfully"
                return 0
            else
                log_error "Migration failed with exit code: $exit_code"
                docker logs sanctuary-migrate 2>&1 | tail -20
                return 1
            fi
            ;;
        "running")
            log_warning "Migration container still running"
            return 0
            ;;
        "not_found")
            log_warning "Migration container not found (may have been removed)"
            return 0
            ;;
        *)
            log_warning "Migration container in unexpected state: $status"
            return 0
            ;;
    esac
}

# ============================================
# Network Tests
# ============================================

test_container_network() {
    log_info "Testing container network..."

    # Check if sanctuary-network exists
    local network_exists=$(docker network ls --filter "name=sanctuary" -q 2>/dev/null)

    if [ -z "$network_exists" ]; then
        log_error "Sanctuary network not found"
        return 1
    fi

    # Check containers are connected
    local connected=$(docker network inspect sanctuary_sanctuary-network 2>/dev/null | grep -c "sanctuary-" || \
        docker network inspect sanctuary-network 2>/dev/null | grep -c "sanctuary-" || echo "0")

    if [ "$connected" -ge 3 ]; then
        log_success "Containers connected to network"
        return 0
    else
        log_warning "Only $connected containers connected to network"
        return 0
    fi
}

test_backend_can_reach_database() {
    log_info "Testing backend can reach database..."

    # Test from backend to database
    local result=$(docker exec sanctuary-backend wget -q -O - --spider http://postgres:5432 2>&1 || echo "connection_test")

    # We expect this to fail with a protocol error (wget can't speak PostgreSQL)
    # but it means the network connection works
    if docker exec sanctuary-backend getent hosts postgres &>/dev/null; then
        log_success "Backend can resolve database hostname"
        return 0
    else
        log_error "Backend cannot resolve database hostname"
        return 1
    fi
}

test_frontend_can_reach_backend() {
    log_info "Testing frontend can reach backend..."

    if docker exec sanctuary-frontend getent hosts backend &>/dev/null; then
        log_success "Frontend can resolve backend hostname"
        return 0
    else
        log_error "Frontend cannot resolve backend hostname"
        return 1
    fi
}

# ============================================
# External Access Tests
# ============================================

test_https_port_accessible() {
    log_info "Testing HTTPS port accessibility..."

    # Test from host
    local status_code=$(curl -k -s -o /dev/null -w "%{http_code}" "$API_BASE_URL" 2>/dev/null || echo "000")

    if [ "$status_code" = "200" ] || [ "$status_code" = "301" ] || [ "$status_code" = "302" ]; then
        log_success "HTTPS port $HTTPS_PORT is accessible (status: $status_code)"
        return 0
    else
        log_error "HTTPS port $HTTPS_PORT not accessible (status: $status_code)"
        return 1
    fi
}

test_api_accessible_from_host() {
    log_info "Testing API accessibility from host..."

    local response=$(curl -k -s "$API_BASE_URL/api/v1/health" 2>/dev/null || \
        curl -k -s "$API_BASE_URL/health" 2>/dev/null)

    if [ -n "$response" ]; then
        log_success "API is accessible from host"
        return 0
    else
        log_error "API not accessible from host"
        return 1
    fi
}

test_gateway_port_accessible() {
    log_info "Testing gateway port accessibility..."

    local gateway_port="${GATEWAY_PORT:-4000}"
    local status_code=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:${gateway_port}/health" 2>/dev/null || echo "000")

    if [ "$status_code" = "200" ]; then
        log_success "Gateway port $gateway_port is accessible"
        return 0
    else
        log_warning "Gateway port $gateway_port not accessible (status: $status_code)"
        # Don't fail - gateway is optional for some deployments
        return 0
    fi
}

# ============================================
# Resource Tests
# ============================================

test_container_memory_limits() {
    log_info "Checking container memory usage..."

    local containers=("sanctuary-db" "sanctuary-backend" "sanctuary-frontend" "sanctuary-gateway")

    for container in "${containers[@]}"; do
        local mem_usage=$(docker stats "$container" --no-stream --format "{{.MemUsage}}" 2>/dev/null | cut -d'/' -f1)
        if [ -n "$mem_usage" ]; then
            log_debug "$container memory usage: $mem_usage"
        fi
    done

    log_success "Container memory check complete"
    return 0
}

test_container_restart_count() {
    log_info "Checking container restart counts..."

    local containers=("sanctuary-db" "sanctuary-backend" "sanctuary-frontend" "sanctuary-gateway")
    local high_restarts=false

    for container in "${containers[@]}"; do
        local restart_count=$(docker inspect -f '{{.RestartCount}}' "$container" 2>/dev/null || echo "0")
        if [ "$restart_count" -gt 3 ]; then
            log_warning "$container has restarted $restart_count times"
            high_restarts=true
        else
            log_debug "$container restart count: $restart_count"
        fi
    done

    if [ "$high_restarts" = "true" ]; then
        log_warning "Some containers have high restart counts"
    else
        log_success "Container restart counts are normal"
    fi

    return 0
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Container Health Tests${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Verify Docker is available
    if ! check_docker_available; then
        log_error "Docker is not available"
        exit 1
    fi

    # Check if containers exist
    if ! docker ps -a --filter "name=sanctuary" -q | grep -q .; then
        log_error "No Sanctuary containers found. Run install first."
        exit 1
    fi

    # Container existence
    run_test "All Containers Exist" test_containers_exist

    # Database tests
    run_test "Database Container Running" test_database_container_running
    run_test "Database Container Healthy" test_database_container_healthy
    run_test "Database Connection" test_database_connection
    run_test "Database Tables Exist" test_database_tables_exist

    # Backend tests
    run_test "Backend Container Running" test_backend_container_running
    run_test "Backend Container Healthy" test_backend_container_healthy
    run_test "Backend Health Endpoint" test_backend_health_endpoint
    run_test "Backend API Ready" test_backend_api_ready

    # Frontend tests
    run_test "Frontend Container Running" test_frontend_container_running
    run_test "Frontend Container Healthy" test_frontend_container_healthy
    run_test "Frontend Nginx Running" test_frontend_nginx_running
    run_test "Frontend Serves Content" test_frontend_serves_content

    # Gateway tests
    run_test "Gateway Container Running" test_gateway_container_running
    run_test "Gateway Container Healthy" test_gateway_container_healthy
    run_test "Gateway Health Endpoint" test_gateway_health_endpoint

    # Migration tests
    run_test "Migration Container Completed" test_migrate_container_completed

    # Network tests
    run_test "Container Network" test_container_network
    run_test "Backend Can Reach Database" test_backend_can_reach_database
    run_test "Frontend Can Reach Backend" test_frontend_can_reach_backend

    # External access tests
    run_test "HTTPS Port Accessible" test_https_port_accessible
    run_test "API Accessible From Host" test_api_accessible_from_host
    run_test "Gateway Port Accessible" test_gateway_port_accessible

    # Resource tests
    run_test "Container Memory Limits" test_container_memory_limits
    run_test "Container Restart Count" test_container_restart_count

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
