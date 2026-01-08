#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Install Script
# ============================================
#
# One-liner installation:
#   curl -fsSL https://raw.githubusercontent.com/n-narusegawa/sanctuary/main/install.sh | bash
#
# Or download and run:
#   wget -O install.sh https://raw.githubusercontent.com/n-narusegawa/sanctuary/main/install.sh
#   chmod +x install.sh && ./install.sh
#
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO_URL="https://github.com/n-narusegawa/sanctuary.git"
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
SKIP_GIT_CHECKOUT="${SKIP_GIT_CHECKOUT:-false}"  # Set to 'true' in CI to skip version checkout

# ============================================
# Get latest release tag
# ============================================
get_latest_release() {
    # Try GitHub API first (most reliable)
    if command -v curl &> /dev/null; then
        local tag=$(curl -fsSL "https://api.github.com/repos/n-narusegawa/sanctuary/releases/latest" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
        if [ -n "$tag" ]; then
            echo "$tag"
            return 0
        fi
    fi

    # Fallback: use git ls-remote to get latest tag
    local tag=$(git ls-remote --tags --sort=-v:refname "$REPO_URL" 2>/dev/null | head -1 | sed 's/.*refs\/tags\///' | sed 's/\^{}//')
    if [ -n "$tag" ]; then
        echo "$tag"
        return 0
    fi

    # Last resort: return empty (will use main)
    echo ""
}

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}              ${GREEN}Sanctuary Bitcoin Wallet${NC}                    ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}           Your keys, your coins, your server.             ${BLUE}║${NC}"
echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ============================================
# Check prerequisites
# ============================================
check_docker() {
    if ! command -v docker &> /dev/null; then
        echo -e "${RED}Error: Docker is not installed.${NC}"
        echo ""
        echo "Please install Docker first:"
        echo "  - Windows/Mac: https://www.docker.com/products/docker-desktop"
        echo "  - Linux: curl -fsSL https://get.docker.com | sh"
        echo ""
        exit 1
    fi

    if ! docker info &> /dev/null; then
        echo -e "${RED}Error: Cannot connect to Docker daemon.${NC}"
        echo ""
        if [ -e /var/run/docker.sock ]; then
            echo "The Docker socket exists but you don't have permission to access it."
            echo "To fix this, add your user to the docker group:"
            echo ""
            echo "  sudo usermod -aG docker \$USER"
            echo "  newgrp docker   # Apply immediately, or log out and back in"
            echo ""
            echo "Then run this installer again."
        else
            echo "Please start Docker and try again:"
            echo "  sudo systemctl start docker"
        fi
        exit 1
    fi

    # Check for docker compose (v2)
    if ! docker compose version &> /dev/null; then
        echo -e "${RED}Error: Docker Compose v2 is not available.${NC}"
        echo ""
        echo "Please update Docker or install Docker Compose plugin."
        exit 1
    fi

    echo -e "${GREEN}✓${NC} Docker is installed and running"
}

check_openssl() {
    if ! command -v openssl &> /dev/null; then
        echo -e "${YELLOW}Warning: OpenSSL not found.${NC}"
        # Try to install openssl on Debian/Ubuntu
        if command -v apt-get &> /dev/null; then
            echo "  Attempting to install OpenSSL..."
            if sudo apt-get update -qq && sudo apt-get install -y -qq openssl >/dev/null 2>&1; then
                echo -e "${GREEN}✓${NC} OpenSSL installed successfully"
                return 0
            else
                echo -e "${YELLOW}  Could not install OpenSSL automatically.${NC}"
            fi
        fi
        echo -e "${YELLOW}  SSL certificates cannot be generated without OpenSSL.${NC}"
        return 1
    fi
    echo -e "${GREEN}✓${NC} OpenSSL is available"
    return 0
}

# Check if openssl is available (returns 0/1, no output)
has_openssl() {
    command -v openssl &> /dev/null
}

# ============================================
# Pre-flight resource checks
# ============================================
check_disk_space() {
    local required_gb=6
    local install_dir="${1:-$HOME}"

    if command -v df &> /dev/null; then
        # Get available space in KB, handle different df output formats
        local available_kb=$(df -k "$install_dir" 2>/dev/null | tail -1 | awk '{print $4}')
        if [ -n "$available_kb" ] && [ "$available_kb" -gt 0 ] 2>/dev/null; then
            local available_gb=$((available_kb / 1024 / 1024))
            if [ "$available_kb" -lt $((required_gb * 1024 * 1024)) ]; then
                echo -e "${YELLOW}Warning: Low disk space detected.${NC}"
                echo "  Available: ${available_gb}GB (recommended: ${required_gb}GB+)"
                echo "  Docker images and build cache require significant space."
                echo ""
            else
                echo -e "${GREEN}✓${NC} Disk space: ${available_gb}GB available"
            fi
        fi
    fi
}

check_memory() {
    local required_gb=4

    # Linux: read from /proc/meminfo
    if [ -f /proc/meminfo ]; then
        local total_kb=$(grep MemTotal /proc/meminfo 2>/dev/null | awk '{print $2}')
        if [ -n "$total_kb" ] && [ "$total_kb" -gt 0 ] 2>/dev/null; then
            local total_gb=$((total_kb / 1024 / 1024))
            if [ "$total_kb" -lt $((required_gb * 1024 * 1024)) ]; then
                echo -e "${YELLOW}Warning: Low memory detected.${NC}"
                echo "  Available: ${total_gb}GB RAM (recommended: ${required_gb}GB+)"
                echo "  Sanctuary containers require approximately 4GB RAM."
                echo ""
            else
                echo -e "${GREEN}✓${NC} Memory: ${total_gb}GB RAM available"
            fi
        fi
    # macOS: use sysctl
    elif command -v sysctl &> /dev/null; then
        local total_bytes=$(sysctl -n hw.memsize 2>/dev/null)
        if [ -n "$total_bytes" ] && [ "$total_bytes" -gt 0 ] 2>/dev/null; then
            local total_gb=$((total_bytes / 1024 / 1024 / 1024))
            if [ "$total_gb" -lt "$required_gb" ]; then
                echo -e "${YELLOW}Warning: Low memory detected.${NC}"
                echo "  Available: ${total_gb}GB RAM (recommended: ${required_gb}GB+)"
                echo ""
            else
                echo -e "${GREEN}✓${NC} Memory: ${total_gb}GB RAM available"
            fi
        fi
    fi
}

check_wsl() {
    if uname -r 2>/dev/null | grep -qi "wsl\|microsoft"; then
        echo -e "${BLUE}ℹ${NC} WSL detected - ensure Docker Desktop for Windows is running"
    fi
}

check_architecture() {
    local arch=$(uname -m 2>/dev/null)
    case "$arch" in
        arm64|aarch64)
            echo -e "${BLUE}ℹ${NC} ARM64 architecture detected"
            # Check if running on Apple Silicon Mac
            if [ "$(uname -s)" = "Darwin" ]; then
                echo "  Apple Silicon Mac - Docker Desktop includes Rosetta for x86 images"
            else
                echo "  Some images may need ARM64 variants or emulation"
            fi
            ;;
        x86_64|amd64)
            # Standard architecture, no message needed
            ;;
        *)
            echo -e "${YELLOW}ℹ${NC} Unusual architecture detected: $arch"
            echo "  Some Docker images may not be available for this platform"
            ;;
    esac
}

check_git() {
    if ! command -v git &> /dev/null; then
        echo -e "${RED}Error: Git is not installed.${NC}"
        echo ""
        echo "Please install Git first:"
        echo "  - Windows: https://git-scm.com/download/win"
        echo "  - Mac: brew install git"
        echo "  - Linux: sudo apt install git"
        echo ""
        exit 1
    fi
    echo -e "${GREEN}✓${NC} Git is installed"
}

# ============================================
# Generate random JWT secret
# ============================================
generate_secret() {
    # Try multiple methods for maximum compatibility
    if command -v openssl &> /dev/null; then
        openssl rand -base64 32 | tr -d '=/+' | head -c 48
    elif [ -f /dev/urandom ]; then
        cat /dev/urandom | LC_ALL=C tr -dc 'a-zA-Z0-9' | head -c 48
    else
        # Fallback: use date + process ID (less secure but works everywhere)
        echo "$(date +%s%N)$$" | sha256sum | head -c 48
    fi
}

# ============================================
# Main installation
# ============================================
main() {
    echo "Checking prerequisites..."
    echo ""

    check_docker
    check_git
    check_openssl  # Display status message
    HAS_OPENSSL=$(has_openssl && echo "yes" || echo "no")
    check_disk_space "$HOME"
    check_memory
    check_wsl
    check_architecture

    echo ""

    # Get the latest release tag (skip in CI to test current code)
    if [ "$SKIP_GIT_CHECKOUT" = "true" ]; then
        echo -e "${GREEN}✓${NC} Skipping git checkout (SKIP_GIT_CHECKOUT=true)"
        RELEASE_TAG=""
        cd "$INSTALL_DIR"
    else
        echo "Fetching latest release..."
        RELEASE_TAG=$(get_latest_release)
        if [ -n "$RELEASE_TAG" ]; then
            echo -e "${GREEN}✓${NC} Latest release: $RELEASE_TAG"
        else
            echo -e "${YELLOW}⚠${NC} Could not determine latest release, using main branch"
        fi

        # Clone or update repository
        if [ -d "$INSTALL_DIR" ]; then
            echo -e "${YELLOW}Directory $INSTALL_DIR already exists.${NC}"

            # Show version information
            cd "$INSTALL_DIR"
            CURRENT_VERSION=$(git describe --tags 2>/dev/null || git rev-parse --short HEAD 2>/dev/null || echo "unknown")
            echo ""
            echo "  Current version: $CURRENT_VERSION"
            if [ -n "$RELEASE_TAG" ]; then
                echo "  New version:     $RELEASE_TAG"
            fi

            # Check if database container exists with data
            if docker volume ls -q 2>/dev/null | grep -q "sanctuary.*postgres_data\|postgres_data"; then
                echo ""
                echo -e "${YELLOW}Existing database detected.${NC}"
                echo ""
                echo "Before upgrading, we recommend backing up your database:"
                echo -e "  ${GREEN}docker exec \$(docker compose ps -q postgres) pg_dump -U sanctuary sanctuary > backup-\$(date +%Y%m%d).sql${NC}"
                echo ""
                if [ -t 0 ]; then
                    read -p "Continue with upgrade? [Y/n] " -n 1 -r
                    echo ""
                    if [[ $REPLY =~ ^[Nn]$ ]]; then
                        echo "Upgrade cancelled. Run again after backing up."
                        exit 0
                    fi
                fi
            fi

            echo ""
            echo "Updating existing installation..."
            git fetch --tags 2>/dev/null || true
            if [ -n "$RELEASE_TAG" ]; then
                git checkout "$RELEASE_TAG" 2>/dev/null || {
                    echo -e "${YELLOW}Could not checkout $RELEASE_TAG. Continuing with current version.${NC}"
                }
            fi
        else
            echo "Cloning Sanctuary to $INSTALL_DIR..."
            git clone "$REPO_URL" "$INSTALL_DIR"
            cd "$INSTALL_DIR"
            if [ -n "$RELEASE_TAG" ]; then
                git checkout "$RELEASE_TAG" 2>/dev/null || {
                    echo -e "${YELLOW}Could not checkout $RELEASE_TAG. Using main branch.${NC}"
                }
            fi
        fi
    fi

    echo -e "${GREEN}✓${NC} Repository ready"
    echo ""

    # Generate SSL certificates if needed
    SSL_DIR="$INSTALL_DIR/docker/nginx/ssl"
    if [ ! -f "$SSL_DIR/fullchain.pem" ] || [ ! -f "$SSL_DIR/privkey.pem" ]; then
        echo "Generating SSL certificates..."
        if [ "$HAS_OPENSSL" = "yes" ]; then
            mkdir -p "$SSL_DIR"
            chmod +x "$SSL_DIR/generate-certs.sh"
            cd "$SSL_DIR" && ./generate-certs.sh localhost
            cd "$INSTALL_DIR"
            echo -e "${GREEN}✓${NC} SSL certificates generated"
        else
            echo -e "${RED}✗${NC} Could not generate SSL certificates (OpenSSL not found)"
            echo ""
            echo -e "${YELLOW}IMPORTANT: HTTPS will not work without SSL certificates!${NC}"
            echo ""
            echo "To fix this, install OpenSSL and regenerate certificates:"
            echo "  sudo apt install openssl    # Debian/Ubuntu"
            echo "  sudo yum install openssl    # CentOS/RHEL"
            echo "  brew install openssl        # macOS"
            echo ""
            echo "Then run: cd $SSL_DIR && ./generate-certs.sh localhost"
            echo ""
            echo "Until then, you can access Sanctuary via HTTP on port ${HTTP_PORT:-8080}"
            echo "(Note: Hardware wallet support requires HTTPS)"
            echo ""
        fi
    else
        echo -e "${GREEN}✓${NC} SSL certificates already exist"
    fi

    echo ""

    # Load existing secrets or generate new ones
    # Check .env first (Docker Compose default), then .env.local for backwards compatibility
    if [ -f "$INSTALL_DIR/.env" ]; then
        set -a
        source "$INSTALL_DIR/.env"
        set +a
        echo -e "${GREEN}✓${NC} Using existing secrets from .env"
        ENV_FILE="$INSTALL_DIR/.env"

        # Generate missing secrets (upgrading from older version)
        UPDATED_ENV=false
        if [ -z "$ENCRYPTION_KEY" ]; then
            ENCRYPTION_KEY=$(generate_secret)
            echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> "$ENV_FILE"
            echo -e "${GREEN}✓${NC} Generated missing ENCRYPTION_KEY"
            UPDATED_ENV=true
        fi
        if [ -z "$GATEWAY_SECRET" ]; then
            GATEWAY_SECRET=$(generate_secret)
            echo "GATEWAY_SECRET=$GATEWAY_SECRET" >> "$ENV_FILE"
            echo -e "${GREEN}✓${NC} Generated missing GATEWAY_SECRET"
            UPDATED_ENV=true
        fi
        if [ -z "$ENCRYPTION_SALT" ]; then
            ENCRYPTION_SALT=$(openssl rand -base64 16)
            echo "ENCRYPTION_SALT=$ENCRYPTION_SALT" >> "$ENV_FILE"
            echo -e "${GREEN}✓${NC} Generated missing ENCRYPTION_SALT"
            UPDATED_ENV=true
        fi
        if [ -z "$POSTGRES_PASSWORD" ]; then
            POSTGRES_PASSWORD=$(generate_secret | head -c 24)
            echo "POSTGRES_PASSWORD=$POSTGRES_PASSWORD" >> "$ENV_FILE"
            echo -e "${GREEN}✓${NC} Generated missing POSTGRES_PASSWORD"
            UPDATED_ENV=true
        fi
    elif [ -f "$INSTALL_DIR/.env.local" ]; then
        # Backwards compatibility: migrate from .env.local to .env
        source "$INSTALL_DIR/.env.local"
        echo -e "${YELLOW}!${NC} Migrating secrets from .env.local to .env"
        ENV_FILE="$INSTALL_DIR/.env"
        UPDATED_ENV=true

        # Generate missing secrets
        if [ -z "$ENCRYPTION_KEY" ]; then
            ENCRYPTION_KEY=$(generate_secret)
            echo -e "${GREEN}✓${NC} Generated missing ENCRYPTION_KEY"
        fi
        if [ -z "$GATEWAY_SECRET" ]; then
            GATEWAY_SECRET=$(generate_secret)
            echo -e "${GREEN}✓${NC} Generated missing GATEWAY_SECRET"
        fi
        if [ -z "$ENCRYPTION_SALT" ]; then
            ENCRYPTION_SALT=$(openssl rand -base64 16)
            echo -e "${GREEN}✓${NC} Generated missing ENCRYPTION_SALT"
        fi
        if [ -z "$POSTGRES_PASSWORD" ]; then
            POSTGRES_PASSWORD=$(generate_secret | head -c 24)
            echo -e "${GREEN}✓${NC} Generated missing POSTGRES_PASSWORD"
        fi
    else
        JWT_SECRET=$(generate_secret)
        ENCRYPTION_KEY=$(generate_secret)
        GATEWAY_SECRET=$(generate_secret)
        ENCRYPTION_SALT=$(openssl rand -base64 16)
        POSTGRES_PASSWORD=$(generate_secret | head -c 24)
        echo -e "${GREEN}✓${NC} Generated secure secrets"
    fi

    # Check for port conflicts
    check_port_conflict() {
        local port="$1"
        local name="$2"
        if command -v ss &> /dev/null; then
            if ss -tuln 2>/dev/null | grep -q ":${port} "; then
                echo -e "${YELLOW}Warning: $name port ${port} is already in use.${NC}"
                return 1
            fi
        elif command -v netstat &> /dev/null; then
            if netstat -tuln 2>/dev/null | grep -q ":${port} "; then
                echo -e "${YELLOW}Warning: $name port ${port} is already in use.${NC}"
                return 1
            fi
        fi
        return 0
    }

    PORT_CONFLICTS=false
    check_port_conflict "$HTTPS_PORT" "HTTPS" || PORT_CONFLICTS=true
    check_port_conflict "$HTTP_PORT" "HTTP" || PORT_CONFLICTS=true
    check_port_conflict "${GATEWAY_PORT:-4000}" "Gateway" || PORT_CONFLICTS=true

    if [ "$ENABLE_MONITORING" = "true" ]; then
        check_port_conflict "${GRAFANA_PORT:-3000}" "Grafana" || PORT_CONFLICTS=true
    fi

    if [ "$PORT_CONFLICTS" = true ]; then
        echo "  Set alternative ports via environment variables if Sanctuary fails to start."
        echo "  Example: HTTPS_PORT=9443 HTTP_PORT=9080 ./install.sh"
    fi

    echo ""

    # Ask about optional features (skip if non-interactive or env var set)
    ENABLE_MONITORING="${ENABLE_MONITORING:-}"
    ENABLE_TOR="${ENABLE_TOR:-}"
    if [ -z "$ENABLE_MONITORING" ] && [ -t 0 ]; then
        echo -e "${BLUE}Optional Features${NC}"
        echo ""
        echo "Would you like to enable monitoring? (Grafana/Loki/Promtail)"
        echo "  - View logs and metrics in a web dashboard"
        echo "  - Uses ~500MB additional disk space and ~512MB RAM"
        echo ""
        read -p "Enable monitoring? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ENABLE_MONITORING="yes"
            echo -e "${GREEN}✓${NC} Monitoring will be enabled"
        else
            ENABLE_MONITORING="no"
            echo -e "${GREEN}✓${NC} Monitoring skipped (run './start.sh --with-monitoring' later to enable)"
        fi
        echo ""
    fi

    if [ -z "$ENABLE_TOR" ] && [ -t 0 ]; then
        echo "Would you like to enable the built-in Tor proxy?"
        echo "  - Route Electrum connections through Tor for privacy"
        echo "  - Hides your IP address from Electrum servers"
        echo "  - Uses ~50MB additional disk space and ~128MB RAM"
        echo ""
        read -p "Enable Tor? [y/N] " -n 1 -r
        echo ""
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            ENABLE_TOR="yes"
            echo -e "${GREEN}✓${NC} Tor proxy will be enabled"
        else
            ENABLE_TOR="no"
            echo -e "${GREEN}✓${NC} Tor skipped (run './start.sh --with-tor' later to enable)"
        fi
        echo ""
    fi

    # Save secrets to .env BEFORE starting docker compose
    # This ensures docker compose can read them and allows manual docker compose commands
    cat > "$INSTALL_DIR/.env" << ENVEOF
# Sanctuary Environment Configuration
# This file is auto-loaded by docker compose

JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENCRYPTION_SALT=$ENCRYPTION_SALT
GATEWAY_SECRET=$GATEWAY_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

HTTP_PORT=${HTTP_PORT:-8080}
HTTPS_PORT=${HTTPS_PORT:-8443}
ENABLE_MONITORING=${ENABLE_MONITORING:-no}
ENABLE_TOR=${ENABLE_TOR:-no}
ENVEOF

    echo -e "${GREEN}✓${NC} Saved configuration to .env"

    # Remove old .env.local if it exists (migrated to .env)
    if [ -f "$INSTALL_DIR/.env.local" ]; then
        rm -f "$INSTALL_DIR/.env.local"
        echo -e "${GREEN}✓${NC} Cleaned up old .env.local (migrated to .env)"
    fi

    echo ""
    echo "Starting Sanctuary..."
    echo -e "${YELLOW}Note: First-time build may take 2-5 minutes. Subsequent starts are much faster.${NC}"
    echo ""

    # Start the services
    cd "$INSTALL_DIR"
    COMPOSE_FILES="-f docker-compose.yml"
    [ "$ENABLE_MONITORING" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
    [ "$ENABLE_TOR" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tor.yml"

    HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" \
        JWT_SECRET="$JWT_SECRET" \
        ENCRYPTION_KEY="$ENCRYPTION_KEY" \
        GATEWAY_SECRET="$GATEWAY_SECRET" \
        POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
        docker compose $COMPOSE_FILES up -d --build

    # Wait for services to be healthy (with proper timeout)
    echo ""
    echo "Waiting for services to start..."

    MAX_WAIT=120
    WAITED=0
    INTERVAL=5
    FRONTEND_RUNNING=false

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

    echo ""
    echo -e "${BLUE}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"

    if [ "$FRONTEND_RUNNING" = true ]; then
        echo -e "${BLUE}║${NC}            ${GREEN}Installation complete!${NC}                        ${BLUE}║${NC}"
    else
        echo -e "${BLUE}║${NC}            ${YELLOW}Installation in progress...${NC}                   ${BLUE}║${NC}"
    fi

    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Open your browser:                                       ${BLUE}║${NC}"
    if [ -f "$INSTALL_DIR/docker/nginx/ssl/fullchain.pem" ]; then
        echo -e "${BLUE}║${NC}    ${GREEN}https://localhost:${HTTPS_PORT}${NC}                              ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${YELLOW}Accept the self-signed certificate warning${NC}              ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${YELLOW}(click Advanced → Proceed)${NC}                               ${BLUE}║${NC}"
    else
        echo -e "${BLUE}║${NC}    ${GREEN}http://localhost:${HTTP_PORT}${NC}                               ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${RED}HTTPS unavailable - SSL certs missing${NC}                   ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  ${YELLOW}Install openssl and run: ./start.sh --rebuild${NC}          ${BLUE}║${NC}"
    fi
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Default login:                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Username: ${GREEN}admin${NC}                                        ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Password: ${GREEN}sanctuary${NC}                                    ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  ${YELLOW}You'll be asked to change the password on first login${NC}   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    if [ "$ENABLE_MONITORING" = "yes" ]; then
        echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  Monitoring (Grafana):                                    ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    ${GREEN}http://localhost:3000${NC}                                 ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Username: ${GREEN}admin${NC}                                        ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Password: ${GREEN}(your ENCRYPTION_KEY from .env)${NC}             ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    fi
    if [ "$ENABLE_TOR" = "yes" ]; then
        echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}  Tor Proxy:                                               ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Go to ${GREEN}Admin → Node Configuration${NC}                      ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}    Enable ${GREEN}Proxy / Tor${NC} and select ${GREEN}Tor Container${NC}         ${BLUE}║${NC}"
        echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    fi
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Useful commands:                                         ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    View logs:    docker compose logs -f                   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Stop:         docker compose down                      ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Restart:      docker compose restart                   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    echo -e "${GREEN}Tip:${NC} Your secrets have been saved to .env"
    echo ""
    echo "Common commands:"
    echo "  ${GREEN}./start.sh${NC}           Start Sanctuary"
    echo "  ${GREEN}./start.sh --stop${NC}    Stop Sanctuary"
    echo "  ${GREEN}./start.sh --logs${NC}    View logs"
    echo "  ${GREEN}./install.sh${NC}         Upgrade to latest version"
    echo ""
}


# Run main function
main "$@"
