#!/bin/bash
#
# Sanctuary Setup Script
#
# Generates all required secrets and creates .env file
# Run this once before first `docker compose up`
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# Prerequisite Check Functions
# ============================================
# Track check results
PREREQ_ERRORS=""
PREREQ_WARNINGS=""

# Check if Docker is installed
check_docker_installed() {
    if command -v docker &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker is installed"
        return 0
    else
        echo -e "${RED}✗${NC} Docker is not installed"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker not installed${NC}
    Install Docker:
    - Windows/Mac: https://www.docker.com/products/docker-desktop
    - Linux: curl -fsSL https://get.docker.com | sh
"
        return 1
    fi
}

# Check if user can access Docker (daemon running + permissions)
check_docker_access() {
    # Skip if docker isn't installed
    if ! command -v docker &> /dev/null; then
        return 1
    fi

    if docker info &> /dev/null; then
        echo -e "${GREEN}✓${NC} Docker daemon is accessible"
        return 0
    fi

    # Docker command exists but can't connect - diagnose why
    if [ -e /var/run/docker.sock ]; then
        # Socket exists but no permission
        echo -e "${RED}✗${NC} Cannot access Docker (permission denied)"

        # Check if user is in docker group
        if groups 2>/dev/null | grep -qw docker; then
            # User is in docker group but still can't access - group not active
            PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker group membership not active${NC}
    You are in the 'docker' group but it hasn't taken effect yet.
    Fix: Log out and back in, or run:
      newgrp docker
    Then run this script again.
"
        else
            # User is not in docker group
            PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}User not in docker group${NC}
    Your user '$(whoami)' is not in the 'docker' group.
    Fix: Run these commands:
      sudo usermod -aG docker \$USER
      newgrp docker   # Or log out and back in
    Then run this script again.
"
        fi
        return 1
    else
        # Socket doesn't exist - daemon not running
        echo -e "${RED}✗${NC} Docker daemon is not running"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker daemon not running${NC}
    The Docker service is not started.
    Fix: Start Docker:
      sudo systemctl start docker
      sudo systemctl enable docker  # Optional: start on boot
    Then run this script again.
"
        return 1
    fi
}

# Check for Docker Compose v2
check_docker_compose() {
    # Skip if docker isn't accessible
    if ! docker info &> /dev/null 2>&1; then
        return 1
    fi

    if docker compose version &> /dev/null; then
        local version=$(docker compose version --short 2>/dev/null || echo "unknown")
        echo -e "${GREEN}✓${NC} Docker Compose v2 is available (${version})"
        return 0
    else
        echo -e "${RED}✗${NC} Docker Compose v2 is not available"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Docker Compose v2 not available${NC}
    Sanctuary requires Docker Compose v2 (the 'docker compose' command).
    Fix: Update Docker Desktop, or install the compose plugin:
      sudo apt-get update && sudo apt-get install docker-compose-plugin
"
        return 1
    fi
}

# Check if OpenSSL is available
check_openssl() {
    if command -v openssl &> /dev/null; then
        echo -e "${GREEN}✓${NC} OpenSSL is available"
        return 0
    else
        echo -e "${YELLOW}⚠${NC} OpenSSL not found (optional)"
        PREREQ_WARNINGS="${PREREQ_WARNINGS}
  ${YELLOW}OpenSSL not installed${NC}
    SSL certificates cannot be generated without OpenSSL.
    HTTPS will not work, and hardware wallets require HTTPS.
    Fix: Install OpenSSL:
    - Linux: sudo apt install openssl
    - Mac: brew install openssl
"
        return 1
    fi
}

# Run all prerequisite checks
run_prerequisite_checks() {
    echo "Checking prerequisites..."
    echo ""

    # Run all checks (they accumulate errors/warnings)
    check_docker_installed
    check_docker_access
    check_docker_compose
    check_openssl

    echo ""

    # Show any warnings (non-fatal)
    if [ -n "$PREREQ_WARNINGS" ]; then
        echo -e "${YELLOW}Warnings:${NC}"
        echo -e "$PREREQ_WARNINGS"
    fi

    # Show any errors (fatal)
    if [ -n "$PREREQ_ERRORS" ]; then
        echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
        echo -e "${RED}Prerequisites not met. Please fix these issues:${NC}"
        echo -e "$PREREQ_ERRORS"
        echo -e "${RED}═══════════════════════════════════════════════════════════${NC}"
        echo ""
        exit 1
    fi

    echo -e "${GREEN}All prerequisites met!${NC}"
    echo ""
}

# ============================================
# Main Script
# ============================================

echo -e "${BLUE}"
echo "╔═══════════════════════════════════════════════════╗"
echo "║           Sanctuary Setup Script                  ║"
echo "╚═══════════════════════════════════════════════════╝"
echo -e "${NC}"

# Run prerequisite checks first
run_prerequisite_checks

# Check if .env already exists
if [ -f "$ENV_FILE" ]; then
    echo -e "${YELLOW}Warning: .env file already exists.${NC}"
    read -p "Overwrite with new secrets? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Setup cancelled. Your existing .env is unchanged."
        exit 0
    fi
    echo
fi

# Generate secure random strings (aligned with install.sh)
# Uses multiple fallback methods for maximum compatibility
generate_secret() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 32 | tr -d '=/+' | head -c 48
    elif [ -f /dev/urandom ]; then
        cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48
    else
        # Fallback: use date + process ID (less secure but works everywhere)
        echo "$(date +%s%N)$$" | sha256sum | head -c 48
    fi
}

generate_password() {
    if command -v openssl &> /dev/null; then
        openssl rand -base64 16 | tr -d '=/+' | head -c 24
    elif [ -f /dev/urandom ]; then
        cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 24
    else
        echo "$(date +%s%N)$$" | sha256sum | head -c 24
    fi
}

echo -e "${GREEN}Generating secure secrets...${NC}"

JWT_SECRET=$(generate_secret)
ENCRYPTION_KEY=$(generate_secret)
ENCRYPTION_SALT=$(openssl rand -base64 16 2>/dev/null || generate_password)
GATEWAY_SECRET=$(generate_secret)
POSTGRES_PASSWORD=$(generate_password)

echo "  - JWT_SECRET: generated"
echo "  - ENCRYPTION_KEY: generated"
echo "  - ENCRYPTION_SALT: generated"
echo "  - GATEWAY_SECRET: generated"
echo "  - POSTGRES_PASSWORD: generated"
echo

# Create .env file
echo -e "${GREEN}Creating .env file...${NC}"

cat > "$ENV_FILE" << EOF
# Sanctuary Bitcoin Wallet - Environment Configuration
# Generated by setup.sh on $(date)
#
# IMPORTANT: Keep this file secure and never commit to version control

# ============================================
# REQUIRED SECRETS (auto-generated)
# ============================================

# JWT secret for authentication tokens
JWT_SECRET=$JWT_SECRET

# Encryption key for sensitive data (node passwords, etc.)
ENCRYPTION_KEY=$ENCRYPTION_KEY

# Encryption salt for key derivation (required in production)
ENCRYPTION_SALT=$ENCRYPTION_SALT

# Gateway secret for internal service communication
GATEWAY_SECRET=$GATEWAY_SECRET

# PostgreSQL database password
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

# ============================================
# PORTS (defaults are usually fine)
# ============================================

# HTTPS port for web interface
HTTPS_PORT=8443

# HTTP port (redirects to HTTPS)
HTTP_PORT=8080

# Gateway port for mobile app
GATEWAY_PORT=4000

# Gateway TLS - enabled by default for secure mobile connections
GATEWAY_TLS_ENABLED=true

# ============================================
# OPTIONAL - Bitcoin Network
# ============================================

# Options: mainnet, testnet, signet, regtest
BITCOIN_NETWORK=mainnet

# ============================================
# OPTIONAL - Logging
# ============================================

# Options: debug, info, warn, error
LOG_LEVEL=info
EOF

echo -e "${GREEN}Secrets generated!${NC}"
echo

# ============================================
# Generate SSL certificates if needed
# ============================================
SSL_DIR="$PROJECT_DIR/docker/nginx/ssl"
if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
    echo -e "${GREEN}Generating SSL certificates...${NC}"
    if command -v openssl &> /dev/null; then
        mkdir -p "$SSL_DIR"
        chmod +x "$SSL_DIR/generate-certs.sh" 2>/dev/null || true
        if (cd "$SSL_DIR" && ./generate-certs.sh localhost); then
            echo -e "${GREEN}✓${NC} SSL certificates generated"
        else
            echo -e "${YELLOW}⚠${NC} Could not generate SSL certificates"
            echo "  Run manually: cd docker/nginx/ssl && ./generate-certs.sh localhost"
        fi
    else
        echo -e "${YELLOW}⚠${NC} OpenSSL not found - cannot generate SSL certificates"
        echo "  Install openssl and run: cd docker/nginx/ssl && ./generate-certs.sh localhost"
    fi
else
    echo -e "${GREEN}✓${NC} SSL certificates already exist"
    # Ensure permissions allow Docker containers to read the certs
    chmod 644 "$SSL_DIR/privkey.pem" "$SSL_DIR/fullchain.pem" 2>/dev/null || true
fi
echo

# Ask to start services
STARTED=false
FRONTEND_RUNNING=false
if [ -t 0 ]; then
    read -p "Start Sanctuary now? [Y/n] " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Nn]$ ]]; then
        echo ""
        echo "Starting Sanctuary..."
        echo -e "${YELLOW}Note: First-time build may take 2-5 minutes.${NC}"
        echo ""
        cd "$PROJECT_DIR"
        docker compose up -d --build
        STARTED=true

        # Wait for services to be healthy (with proper timeout)
        echo ""
        echo "Waiting for services to start..."

        MAX_WAIT=120
        WAITED=0
        INTERVAL=5

        while [ $WAITED -lt $MAX_WAIT ]; do
            # Check if frontend is healthy (last service to become ready)
            if docker compose ps --format '{{.Service}} {{.Health}}' 2>/dev/null | grep -q "frontend.*healthy"; then
                FRONTEND_RUNNING=true
                break
            fi

            # Check for container failures
            if docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -qE "(Exit|exited)"; then
                echo -e "${YELLOW}Some containers exited. Checking status...${NC}"
                # Migration container exiting with 0 is expected
                FAILED=$(docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -E "(Exit|exited)" | grep -v "migrate" || true)
                if [ -n "$FAILED" ]; then
                    echo -e "${RED}Container failures detected:${NC}"
                    echo "$FAILED"
                    break
                fi
            fi

            sleep $INTERVAL
            WAITED=$((WAITED + INTERVAL))
            echo "  Still starting... ($WAITED/${MAX_WAIT}s)"
        done

        if [ $WAITED -ge $MAX_WAIT ] && [ "$FRONTEND_RUNNING" = false ]; then
            echo -e "${YELLOW}Timeout waiting for services. They may still be starting.${NC}"
            echo "  Check status with: docker compose ps"
            echo "  View logs with: docker compose logs -f"
        fi
    fi
fi
echo

# ============================================
# Setup Complete Banner
# ============================================
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
if [ "$FRONTEND_RUNNING" = true ]; then
    echo -e "${BLUE}║${NC}              ${GREEN}Setup complete! Sanctuary is running.${NC}       ${BLUE}║${NC}"
elif [ "$STARTED" = true ]; then
    echo -e "${BLUE}║${NC}            ${YELLOW}Setup complete! Services starting...${NC}        ${BLUE}║${NC}"
else
    echo -e "${BLUE}║${NC}              ${GREEN}Setup complete!${NC}                              ${BLUE}║${NC}"
fi
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Open your browser:                                       ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    ${GREEN}https://localhost:8443${NC}                                ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}Accept the self-signed certificate warning${NC}              ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}(click Advanced → Proceed)${NC}                               ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Default login:                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    Username: ${GREEN}admin${NC}                                        ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    Password: ${GREEN}sanctuary${NC}                                    ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  ${YELLOW}You'll be asked to change the password on first login${NC}   ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}  Useful commands:                                         ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    View logs:    docker compose logs -f                   ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    Stop:         docker compose down                      ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}    Restart:      docker compose restart                   ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

echo "Common commands:"
echo "  ${GREEN}./start.sh${NC}           Start Sanctuary"
echo "  ${GREEN}./start.sh --stop${NC}    Stop Sanctuary"
echo "  ${GREEN}./start.sh --logs${NC}    View logs"
echo "  ${GREEN}./start.sh --rebuild${NC} Rebuild after code changes"
echo ""

# ============================================
# Critical: Backup Reminder
# ============================================
echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${RED}║${NC}  ${YELLOW}⚠  IMPORTANT: Back up your encryption keys!${NC}              ${RED}║${NC}"
echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "Your encryption keys are stored in: ${GREEN}$ENV_FILE${NC}"
echo ""
echo "These keys encrypt sensitive data (2FA secrets, node passwords)."
echo -e "${RED}If lost, encrypted data cannot be recovered!${NC}"
echo ""
echo -e "${YELLOW}Critical secrets to back up:${NC}"
echo "┌─────────────────────────────────────────────────────────────┐"
echo "│ ENCRYPTION_KEY=$ENCRYPTION_KEY"
echo "│ ENCRYPTION_SALT=$ENCRYPTION_SALT"
echo "└─────────────────────────────────────────────────────────────┘"
echo ""
echo "Back up options:"
echo "  1. Copy the .env file to a secure location"
echo "  2. Save the keys above to a password manager"
echo "  3. Print and store in a safe place"
echo ""
echo -e "${YELLOW}Note:${NC} You'll need these keys if you:"
echo "  - Restore from a backup on a new system"
echo "  - Reinstall Sanctuary"
echo "  - Move to a different server"
echo ""
