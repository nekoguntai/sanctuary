#!/bin/bash
# ============================================
# Authentication Flow Tests
# ============================================
#
# These tests verify the authentication and
# password change flows work correctly.
#
# Run: ./auth-flow.test.sh
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
KEEP_STATE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --verbose|-v)
            VERBOSE=true
            export DEBUG=true
            shift
            ;;
        --keep-state)
            KEEP_STATE=true
            shift
            ;;
        *)
            log_error "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Test configuration
HTTPS_PORT="${HTTPS_PORT:-8443}"
API_BASE_URL="https://localhost:${HTTPS_PORT}"

# Test passwords
DEFAULT_PASSWORD="sanctuary"
NEW_PASSWORD="NewSecurePass123!"
SECOND_PASSWORD="AnotherSecure456!"

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0
declare -a FAILED_TESTS

# State variables
CURRENT_PASSWORD=""
AUTH_TOKEN=""

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
# Helper Functions
# ============================================

make_login_request() {
    local username="$1"
    local password="$2"

    # Delay to avoid rate limiting during rapid test execution
    # Rate limit is 5 attempts per 15 minutes, so we need to be careful
    sleep 1

    curl -k -s -X POST \
        -H "Content-Type: application/json" \
        -d "{\"username\":\"$username\",\"password\":\"$password\"}" \
        "$API_BASE_URL/api/v1/auth/login"
}

extract_token() {
    local response="$1"
    echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4
}

make_authenticated_request() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"
    local token="$AUTH_TOKEN"

    local curl_opts=("-k" "-s" "-X" "$method" "-H" "Authorization: Bearer $token" "-H" "Content-Type: application/json")

    if [ -n "$data" ]; then
        curl_opts+=("-d" "$data")
    fi

    curl "${curl_opts[@]}" "$API_BASE_URL$endpoint"
}

# ============================================
# Test: API Reachable
# ============================================

test_api_reachable() {
    log_info "Testing API reachability..."

    local response=$(curl -k -s "$API_BASE_URL/health" 2>/dev/null || \
        curl -k -s "$API_BASE_URL/api/v1/health" 2>/dev/null)

    if [ -z "$response" ]; then
        log_error "API not reachable at $API_BASE_URL"
        return 1
    fi

    log_success "API is reachable"
    return 0
}

# ============================================
# Test: Login with Default Credentials
# ============================================

test_login_default_credentials() {
    log_info "Testing login with default credentials..."

    local response=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    log_debug "Response: $response"

    if echo "$response" | grep -q '"token"'; then
        AUTH_TOKEN=$(extract_token "$response")
        CURRENT_PASSWORD="$DEFAULT_PASSWORD"
        log_success "Login successful with default credentials"
        return 0
    else
        # Maybe password was already changed
        log_warning "Default password may have been changed"
        CURRENT_PASSWORD=""
        return 0
    fi
}

# ============================================
# Test: Login Response Structure
# ============================================

test_login_response_structure() {
    log_info "Testing login response structure..."

    # Try with default or known password
    local password="${CURRENT_PASSWORD:-$DEFAULT_PASSWORD}"
    local response=$(make_login_request "admin" "$password")

    if [ -z "$response" ]; then
        log_error "No response from login endpoint"
        return 1
    fi

    log_debug "Response: $response"

    # Check for required fields
    local has_token=$(echo "$response" | grep -q '"token"' && echo "yes" || echo "no")
    local has_user=$(echo "$response" | grep -q '"user"' && echo "yes" || echo "no")

    if [ "$has_token" = "no" ]; then
        log_error "Response missing 'token' field"
        return 1
    fi

    if [ "$has_user" = "no" ]; then
        log_error "Response missing 'user' field"
        return 1
    fi

    # Check user object structure
    if ! echo "$response" | grep -q '"username"'; then
        log_error "Response missing 'username' in user object"
        return 1
    fi

    # Verify password is NOT in response
    if echo "$response" | grep -q '"password"'; then
        log_error "SECURITY: Password should not be in response"
        return 1
    fi

    log_success "Login response structure is correct"
    return 0
}

# ============================================
# Test: Invalid Credentials Rejected
# ============================================

test_invalid_credentials_rejected() {
    log_info "Testing invalid credentials are rejected..."

    # Test wrong password
    local response=$(make_login_request "admin" "WrongPassword123!")
    log_debug "Wrong password response: $response"

    if echo "$response" | grep -q '"token"'; then
        log_error "Login succeeded with wrong password"
        return 1
    fi

    # Test non-existent user
    response=$(make_login_request "nonexistent_user_xyz" "SomePassword123!")
    log_debug "Non-existent user response: $response"

    if echo "$response" | grep -q '"token"'; then
        log_error "Login succeeded with non-existent user"
        return 1
    fi

    log_success "Invalid credentials correctly rejected"
    return 0
}

# ============================================
# Test: usingDefaultPassword Flag
# ============================================

test_using_default_password_flag() {
    log_info "Testing usingDefaultPassword flag..."

    if [ -z "$CURRENT_PASSWORD" ] || [ "$CURRENT_PASSWORD" != "$DEFAULT_PASSWORD" ]; then
        log_warning "Not using default password, skipping flag check"
        return 0
    fi

    local response=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    log_debug "Response: $response"

    if echo "$response" | grep -q '"usingDefaultPassword":true'; then
        log_success "usingDefaultPassword flag is set to true"
        return 0
    elif echo "$response" | grep -q '"usingDefaultPassword"'; then
        log_warning "usingDefaultPassword flag exists but is not true"
        return 0
    else
        log_warning "usingDefaultPassword flag not found in response"
        return 0
    fi
}

# ============================================
# Test: Token Verification
# ============================================

test_token_verification() {
    log_info "Testing token verification..."

    if [ -z "$AUTH_TOKEN" ]; then
        # Get a token first
        local password="${CURRENT_PASSWORD:-$DEFAULT_PASSWORD}"
        local response=$(make_login_request "admin" "$password")
        AUTH_TOKEN=$(extract_token "$response")
    fi

    if [ -z "$AUTH_TOKEN" ]; then
        log_error "No auth token available"
        return 1
    fi

    # Test /me endpoint
    local me_response=$(make_authenticated_request "GET" "/api/v1/auth/me")
    log_debug "Me response: $me_response"

    if echo "$me_response" | grep -q '"username"'; then
        log_success "Token verification successful"
        return 0
    else
        log_error "Token verification failed"
        return 1
    fi
}

# ============================================
# Test: Invalid Token Rejected
# ============================================

test_invalid_token_rejected() {
    log_info "Testing invalid token is rejected..."

    # Test with invalid token
    local response=$(curl -k -s -X GET \
        -H "Authorization: Bearer invalid.token.here" \
        -H "Content-Type: application/json" \
        "$API_BASE_URL/api/v1/auth/me")

    log_debug "Invalid token response: $response"

    if echo "$response" | grep -q '"username"'; then
        log_error "Request succeeded with invalid token"
        return 1
    fi

    log_success "Invalid token correctly rejected"
    return 0
}

# ============================================
# Test: Missing Token Rejected
# ============================================

test_missing_token_rejected() {
    log_info "Testing missing token is rejected..."

    local response=$(curl -k -s -X GET \
        -H "Content-Type: application/json" \
        "$API_BASE_URL/api/v1/auth/me")

    log_debug "No token response: $response"

    if echo "$response" | grep -q '"username"'; then
        log_error "Request succeeded without token"
        return 1
    fi

    log_success "Missing token correctly rejected"
    return 0
}

# ============================================
# Test: Password Change
# ============================================

test_password_change() {
    log_info "Testing password change..."

    if [ -z "$CURRENT_PASSWORD" ]; then
        log_warning "No current password known, trying default"
        CURRENT_PASSWORD="$DEFAULT_PASSWORD"
    fi

    # Login first
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    AUTH_TOKEN=$(extract_token "$login_response")

    if [ -z "$AUTH_TOKEN" ]; then
        log_error "Cannot get auth token for password change"
        return 1
    fi

    # Change password
    local change_response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$NEW_PASSWORD\"}")

    log_debug "Change password response: $change_response"

    # Check if error in response
    if echo "$change_response" | grep -qiE '"error"|"message":".*fail|"message":".*invalid'; then
        log_error "Password change failed"
        return 1
    fi

    # Update current password
    CURRENT_PASSWORD="$NEW_PASSWORD"

    log_success "Password changed successfully"
    return 0
}

# ============================================
# Test: Login with New Password
# ============================================

test_login_new_password() {
    log_info "Testing login with new password..."

    local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    log_debug "Response: $response"

    if echo "$response" | grep -q '"token"'; then
        AUTH_TOKEN=$(extract_token "$response")
        log_success "Login successful with new password"
        return 0
    else
        log_error "Login failed with new password"
        return 1
    fi
}

# ============================================
# Test: Old Password No Longer Works
# ============================================

test_old_password_invalid() {
    log_info "Testing old password no longer works..."

    if [ "$CURRENT_PASSWORD" = "$DEFAULT_PASSWORD" ]; then
        log_warning "Password not changed yet, skipping test"
        return 0
    fi

    local response=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    log_debug "Response: $response"

    if echo "$response" | grep -q '"token"'; then
        log_error "Old password still works after change"
        return 1
    fi

    log_success "Old password correctly rejected"
    return 0
}

# ============================================
# Test: Password Change with Wrong Current
# ============================================

test_password_change_wrong_current() {
    log_info "Testing password change with wrong current password..."

    if [ -z "$AUTH_TOKEN" ]; then
        local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
        AUTH_TOKEN=$(extract_token "$response")
    fi

    if [ -z "$AUTH_TOKEN" ]; then
        log_error "Cannot get auth token"
        return 1
    fi

    local response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"WrongCurrentPassword!\",\"newPassword\":\"AnyPassword123!\"}")

    log_debug "Response: $response"

    # Should fail
    if echo "$response" | grep -qiE '"error"|"status":[^2]|"message":".*fail|"message":".*invalid|"message":".*incorrect'; then
        log_success "Password change correctly rejected with wrong current password"
        return 0
    fi

    # If no error indicator, check if it actually succeeded (bad)
    local test_login=$(make_login_request "admin" "AnyPassword123!")
    if echo "$test_login" | grep -q '"token"'; then
        log_error "Password was changed with wrong current password"
        return 1
    fi

    log_success "Password change rejected"
    return 0
}

# ============================================
# Test: Password Complexity Requirements
# ============================================

test_password_complexity() {
    log_info "Testing password complexity requirements..."

    if [ -z "$AUTH_TOKEN" ]; then
        local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
        AUTH_TOKEN=$(extract_token "$response")
    fi

    if [ -z "$AUTH_TOKEN" ]; then
        log_warning "Cannot get auth token, skipping complexity test"
        return 0
    fi

    # Try weak password
    local weak_passwords=("123" "password" "admin")

    for weak_pass in "${weak_passwords[@]}"; do
        local response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
            "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$weak_pass\"}")

        log_debug "Weak password '$weak_pass' response: $response"

        # Verify password wasn't changed
        local test_login=$(make_login_request "admin" "$weak_pass")
        if echo "$test_login" | grep -q '"token"'; then
            log_error "Weak password '$weak_pass' was accepted"
            CURRENT_PASSWORD="$weak_pass"  # Update for cleanup
            return 1
        fi
    done

    log_success "Weak passwords correctly rejected"
    return 0
}

# ============================================
# Test: Second Password Change
# ============================================

test_second_password_change() {
    log_info "Testing second password change..."

    # Login with current password
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    AUTH_TOKEN=$(extract_token "$login_response")

    if [ -z "$AUTH_TOKEN" ]; then
        log_error "Cannot get auth token"
        return 1
    fi

    # Change password again
    local change_response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$SECOND_PASSWORD\"}")

    log_debug "Response: $change_response"

    # Verify new password works
    local test_login=$(make_login_request "admin" "$SECOND_PASSWORD")
    if echo "$test_login" | grep -q '"token"'; then
        CURRENT_PASSWORD="$SECOND_PASSWORD"
        log_success "Second password change successful"
        return 0
    fi

    log_error "Second password change failed"
    return 1
}

# ============================================
# Test: usingDefaultPassword After Change
# ============================================

test_not_using_default_after_change() {
    log_info "Testing usingDefaultPassword is false after change..."

    if [ "$CURRENT_PASSWORD" = "$DEFAULT_PASSWORD" ]; then
        log_warning "Still using default password, skipping test"
        return 0
    fi

    local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    log_debug "Response: $response"

    if echo "$response" | grep -q '"usingDefaultPassword":true'; then
        log_error "usingDefaultPassword should be false after password change"
        return 1
    fi

    log_success "usingDefaultPassword correctly not set after password change"
    return 0
}

# ============================================
# Test: Token Expiration (Optional)
# ============================================

test_token_format() {
    log_info "Testing token format (JWT)..."

    if [ -z "$AUTH_TOKEN" ]; then
        local response=$(make_login_request "admin" "$CURRENT_PASSWORD")
        AUTH_TOKEN=$(extract_token "$response")
    fi

    if [ -z "$AUTH_TOKEN" ]; then
        log_error "No token available"
        return 1
    fi

    # JWT tokens have 3 parts separated by dots
    local parts=$(echo "$AUTH_TOKEN" | tr '.' '\n' | wc -l)

    if [ "$parts" -eq 3 ]; then
        log_success "Token is valid JWT format (3 parts)"
        return 0
    else
        log_error "Token is not valid JWT format (expected 3 parts, got $parts)"
        return 1
    fi
}

# ============================================
# Cleanup: Reset Password to Default
# ============================================

cleanup_reset_password() {
    if [ "$KEEP_STATE" = "true" ]; then
        log_info "Keeping state (--keep-state specified)"
        log_info "Current password: $CURRENT_PASSWORD"
        return 0
    fi

    log_info "Resetting password to default..."

    if [ "$CURRENT_PASSWORD" = "$DEFAULT_PASSWORD" ]; then
        log_info "Already using default password"
        return 0
    fi

    # Login with current password
    local login_response=$(make_login_request "admin" "$CURRENT_PASSWORD")
    AUTH_TOKEN=$(extract_token "$login_response")

    if [ -z "$AUTH_TOKEN" ]; then
        log_warning "Cannot reset password - unable to login"
        return 0
    fi

    # Change back to default
    local change_response=$(make_authenticated_request "POST" "/api/v1/auth/me/change-password" \
        "{\"currentPassword\":\"$CURRENT_PASSWORD\",\"newPassword\":\"$DEFAULT_PASSWORD\"}")

    # Verify
    local test_login=$(make_login_request "admin" "$DEFAULT_PASSWORD")
    if echo "$test_login" | grep -q '"token"'; then
        log_success "Password reset to default"
    else
        log_warning "Could not reset password to default"
    fi
}

# ============================================
# Main Test Runner
# ============================================

main() {
    echo ""
    echo -e "${BLUE}============================================${NC}"
    echo -e "${BLUE} Sanctuary Authentication Flow Tests${NC}"
    echo -e "${BLUE}============================================${NC}"
    echo ""

    # Verify API is reachable first
    run_test "API Reachable" test_api_reachable

    # Login tests
    run_test "Login with Default Credentials" test_login_default_credentials
    run_test "Login Response Structure" test_login_response_structure
    run_test "Invalid Credentials Rejected" test_invalid_credentials_rejected
    run_test "usingDefaultPassword Flag" test_using_default_password_flag

    # Token tests
    run_test "Token Verification" test_token_verification
    run_test "Invalid Token Rejected" test_invalid_token_rejected
    run_test "Missing Token Rejected" test_missing_token_rejected
    run_test "Token Format" test_token_format

    # Password change tests
    run_test "Password Change" test_password_change
    run_test "Login with New Password" test_login_new_password
    run_test "Old Password Invalid" test_old_password_invalid
    run_test "Password Change Wrong Current" test_password_change_wrong_current
    run_test "Password Complexity" test_password_complexity
    run_test "Second Password Change" test_second_password_change
    run_test "Not Using Default After Change" test_not_using_default_after_change

    # Cleanup
    cleanup_reset_password

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
