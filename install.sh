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
    HAS_OPENSSL=$(check_openssl && echo "yes" || echo "no")

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
    if [ -f "$INSTALL_DIR/.env.local" ]; then
        source "$INSTALL_DIR/.env.local"
        echo -e "${GREEN}✓${NC} Using existing secrets from .env.local"

        # Generate ENCRYPTION_KEY if missing (upgrading from older version)
        if [ -z "$ENCRYPTION_KEY" ]; then
            ENCRYPTION_KEY=$(generate_secret)
            echo "ENCRYPTION_KEY=$ENCRYPTION_KEY" >> "$INSTALL_DIR/.env.local"
            echo -e "${GREEN}✓${NC} Generated missing ENCRYPTION_KEY"
        fi
    else
        JWT_SECRET=$(generate_secret)
        ENCRYPTION_KEY=$(generate_secret)
        echo -e "${GREEN}✓${NC} Generated JWT_SECRET and ENCRYPTION_KEY"
    fi

    # Check for port conflicts
    if command -v ss &> /dev/null; then
        if ss -tuln | grep -q ":${HTTPS_PORT} "; then
            echo -e "${YELLOW}Warning: Port ${HTTPS_PORT} is already in use.${NC}"
            echo "  Set HTTPS_PORT to a different value if Sanctuary fails to start."
        fi
    fi

    echo ""
    echo "Starting Sanctuary..."
    echo ""

    # Start the services
    cd "$INSTALL_DIR"
    HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" JWT_SECRET="$JWT_SECRET" ENCRYPTION_KEY="$ENCRYPTION_KEY" \
        docker compose up -d --build

    # Wait for services to be healthy
    echo ""
    echo "Waiting for services to start..."
    sleep 5

    # Check if services are running
    if docker compose ps | grep -q "sanctuary-frontend.*running"; then
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
    echo -e "${BLUE}╠═══════════════════════════════════════════════════════════╣${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}  Useful commands:                                         ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    View logs:    docker compose logs -f                   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Stop:         docker compose down                      ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}    Restart:      docker compose restart                   ${BLUE}║${NC}"
    echo -e "${BLUE}║${NC}                                                           ${BLUE}║${NC}"
    echo -e "${BLUE}╚═══════════════════════════════════════════════════════════╝${NC}"
    echo ""

    # Save secrets for future restarts/upgrades
    cat > "$INSTALL_DIR/.env.local" << ENVEOF
JWT_SECRET=$JWT_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
ENVEOF
    echo -e "${GREEN}Note:${NC} Your secrets have been saved to .env.local"
    echo "      Keep this file secure - you'll need it if you restart the services."
    echo ""
    echo "To restart Sanctuary later:"
    echo "  cd $INSTALL_DIR && source .env.local"
    echo "  HTTPS_PORT=$HTTPS_PORT JWT_SECRET=\$JWT_SECRET ENCRYPTION_KEY=\$ENCRYPTION_KEY docker compose up -d"
    echo ""
}

# Run main function
main "$@"
