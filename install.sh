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
        echo -e "${RED}Error: Docker daemon is not running.${NC}"
        echo ""
        echo "Please start Docker and try again."
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
        echo -e "${YELLOW}Warning: OpenSSL not found. Will use pre-generated certificates.${NC}"
        return 1
    fi
    echo -e "${GREEN}✓${NC} OpenSSL is available"
    return 0
}

# Check if openssl is available (returns 0/1, no output)
has_openssl() {
    command -v openssl &> /dev/null
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

    echo ""

    # Get the latest release tag
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
        echo "Updating existing installation..."
        cd "$INSTALL_DIR"
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
            echo -e "${YELLOW}⚠${NC} Could not generate certificates (OpenSSL not found)"
            echo "  You'll need to provide SSL certificates manually."
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
        if [ -z "$POSTGRES_PASSWORD" ]; then
            POSTGRES_PASSWORD=$(generate_secret | head -c 24)
            echo -e "${GREEN}✓${NC} Generated missing POSTGRES_PASSWORD"
        fi
    else
        JWT_SECRET=$(generate_secret)
        ENCRYPTION_KEY=$(generate_secret)
        GATEWAY_SECRET=$(generate_secret)
        POSTGRES_PASSWORD=$(generate_secret | head -c 24)
        echo -e "${GREEN}✓${NC} Generated secure secrets"
    fi

    # Check for port conflicts
    if command -v ss &> /dev/null; then
        if ss -tuln | grep -q ":${HTTPS_PORT} "; then
            echo -e "${YELLOW}Warning: Port ${HTTPS_PORT} is already in use.${NC}"
            echo "  Set HTTPS_PORT to a different value if Sanctuary fails to start."
        fi
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

    # Wait for services to be healthy
    echo ""
    echo "Waiting for services to start..."
    sleep 5

    # Check if services are running (use docker compose ps which respects project name)
    if docker compose ps --format '{{.Service}} {{.State}}' 2>/dev/null | grep -q "frontend.*running"; then
        FRONTEND_RUNNING=true
    else
        FRONTEND_RUNNING=false
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
    echo -e "${BLUE}║${NC}    ${GREEN}https://localhost:${HTTPS_PORT}${NC}                              ${BLUE}║${NC}"
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

    # Save secrets and preferences for future restarts/upgrades
    # Write to .env (Docker Compose's default file) so docker compose works without start.sh
    cat > "$INSTALL_DIR/.env" << ENVEOF
# Sanctuary Environment Configuration
# This file is auto-loaded by docker compose

JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
GATEWAY_SECRET=$GATEWAY_SECRET
POSTGRES_PASSWORD=$POSTGRES_PASSWORD

HTTP_PORT=${HTTP_PORT:-8080}
HTTPS_PORT=${HTTPS_PORT:-8443}
ENABLE_MONITORING=${ENABLE_MONITORING:-no}
ENABLE_TOR=${ENABLE_TOR:-no}
ENVEOF

    # Remove old .env.local if it exists (migrated to .env)
    if [ -f "$INSTALL_DIR/.env.local" ]; then
        rm -f "$INSTALL_DIR/.env.local"
        echo -e "${GREEN}✓${NC} Cleaned up old .env.local (migrated to .env)"
    fi

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
