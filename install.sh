#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Install Script
# ============================================
#
# One-liner installation (GitHub):
#   curl -fsSL https://raw.githubusercontent.com/nekoguntai/sanctuary/main/install.sh | bash
#
# One-liner installation (GitLab):
#   curl -fsSL https://gitlab.com/narusegawa-nekoworks/sanctuary/-/raw/main/install.sh | bash
#
# Or download and run:
#   ./install.sh                    # Auto-detect source from git remote
#   ./install.sh --source github    # Force GitHub
#   ./install.sh --source gitlab    # Force GitLab
#
# ============================================

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# ============================================
# Platform detection and configuration
# ============================================
detect_source() {
    # Check if --source argument was provided
    while [[ $# -gt 0 ]]; do
        case $1 in
            --source)
                SOURCE="$2"
                shift 2
                ;;
            --source=*)
                SOURCE="${1#*=}"
                shift
                ;;
            *)
                shift
                ;;
        esac
    done

    # If source specified, use it
    if [ -n "$SOURCE" ]; then
        case "$SOURCE" in
            github|GitHub)
                echo "github"
                return
                ;;
            gitlab|GitLab)
                echo "gitlab"
                return
                ;;
            *)
                echo -e "${YELLOW}Unknown source '$SOURCE', auto-detecting...${NC}" >&2
                ;;
        esac
    fi

    # Auto-detect from existing git remote
    if [ -d ".git" ] || [ -d "$INSTALL_DIR/.git" ]; then
        local remote_url
        if [ -d ".git" ]; then
            remote_url=$(git config --get remote.origin.url 2>/dev/null || true)
        else
            remote_url=$(git -C "$INSTALL_DIR" config --get remote.origin.url 2>/dev/null || true)
        fi

        if echo "$remote_url" | grep -qi "gitlab"; then
            echo "gitlab"
            return
        elif echo "$remote_url" | grep -qi "github"; then
            echo "github"
            return
        fi
    fi

    # Default to GitHub
    echo "github"
}

# Detect source platform
SOURCE_PLATFORM=$(detect_source "$@")

# Set platform-specific URLs
case "$SOURCE_PLATFORM" in
    gitlab)
        REPO_URL="https://gitlab.com/narusegawa-nekoworks/sanctuary.git"
        API_URL="https://gitlab.com/api/v4/projects/narusegawa-nekoworks%2Fsanctuary/releases"
        PLATFORM_NAME="GitLab"
        ;;
    github|*)
        REPO_URL="https://github.com/nekoguntai/sanctuary.git"
        API_URL="https://api.github.com/repos/nekoguntai/sanctuary/releases/latest"
        PLATFORM_NAME="GitHub"
        ;;
esac

# Configuration
INSTALL_DIR="${SANCTUARY_DIR:-$HOME/sanctuary}"
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"
SKIP_GIT_CHECKOUT="${SKIP_GIT_CHECKOUT:-false}"  # Set to 'true' in CI to skip version checkout

# ============================================
# Get latest release tag
# ============================================
get_latest_release() {
    local tag=""

    # Try platform-specific API first
    if command -v curl &> /dev/null; then
        case "$SOURCE_PLATFORM" in
            gitlab)
                # GitLab API returns array of releases, get first (latest) tag_name
                tag=$(curl -fsSL "$API_URL" 2>/dev/null | grep -o '"tag_name":"[^"]*"' | head -1 | cut -d'"' -f4)
                ;;
            github|*)
                # GitHub API returns single release object
                tag=$(curl -fsSL "$API_URL" 2>/dev/null | grep '"tag_name"' | head -1 | cut -d'"' -f4)
                ;;
        esac

        if [ -n "$tag" ]; then
            echo "$tag"
            return 0
        fi
    fi

    # Fallback: use git ls-remote to get latest tag
    tag=$(git ls-remote --tags --sort=-v:refname "$REPO_URL" 2>/dev/null | head -1 | sed 's/.*refs\/tags\///' | sed 's/\^{}//')
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
echo -e "${GREEN}✓${NC} Source: ${PLATFORM_NAME} (${REPO_URL})"
echo ""

# ============================================
# Prerequisite Check Functions
# ============================================
# These functions check requirements and store results for summary display.
# They don't exit immediately - we collect all failures first.

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
    Then run this installer again.
"
        else
            # User is not in docker group
            PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}User not in docker group${NC}
    Your user '$(whoami)' is not in the 'docker' group.
    Fix: Run these commands:
      sudo usermod -aG docker \$USER
      newgrp docker   # Or log out and back in
    Then run this installer again.
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
    Then run this installer again.
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

# Check if Git is installed
check_git_installed() {
    if command -v git &> /dev/null; then
        echo -e "${GREEN}✓${NC} Git is installed"
        return 0
    else
        echo -e "${RED}✗${NC} Git is not installed"
        PREREQ_ERRORS="${PREREQ_ERRORS}
  ${RED}Git not installed${NC}
    Git is required to download Sanctuary.
    Fix: Install Git:
    - Windows: https://git-scm.com/download/win
    - Mac: brew install git
    - Linux: sudo apt install git
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

# Check if openssl is available (returns 0/1, no output)
has_openssl() {
    command -v openssl &> /dev/null
}

# ============================================
# Run All Prerequisite Checks
# ============================================
run_prerequisite_checks() {
    echo "Checking prerequisites..."
    echo ""

    # Run all checks (they accumulate errors/warnings)
    check_docker_installed
    check_docker_access
    check_docker_compose
    check_git_installed
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
    # Run all prerequisite checks first (exits if critical checks fail)
    run_prerequisite_checks

    # Store OpenSSL availability for later use
    HAS_OPENSSL=$(has_openssl && echo "yes" || echo "no")

    # Run optional resource/environment checks (warnings only)
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
        # Ensure permissions allow Docker containers to read the certs
        chmod 644 "$SSL_DIR/privkey.pem" "$SSL_DIR/fullchain.pem" 2>/dev/null || true
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

# Gateway TLS - enabled by default for secure mobile connections
GATEWAY_TLS_ENABLED=${GATEWAY_TLS_ENABLED:-true}
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

    # ============================================
    # Critical: Backup Reminder
    # ============================================
    echo -e "${RED}╔═══════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║${NC}  ${YELLOW}⚠  IMPORTANT: Back up your encryption keys!${NC}              ${RED}║${NC}"
    echo -e "${RED}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo "Your encryption keys are stored in: ${GREEN}$INSTALL_DIR/.env${NC}"
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

    echo "Common commands:"
    echo "  ${GREEN}./start.sh${NC}           Start Sanctuary"
    echo "  ${GREEN}./start.sh --stop${NC}    Stop Sanctuary"
    echo "  ${GREEN}./start.sh --logs${NC}    View logs"
    echo "  ${GREEN}./install.sh${NC}         Upgrade to latest version"
    echo ""
}


# Run main function
main "$@"
