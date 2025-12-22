#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Start Script
# ============================================
# Use this script to start Sanctuary after initial installation.
#
# Usage:
#   ./start.sh              # Start with defaults
#   ./start.sh --with-ai    # Start with bundled AI (Ollama)
#   ./start.sh --rebuild    # Rebuild containers (after updates)
#   ./start.sh --stop       # Stop all services
#   ./start.sh --logs       # View logs
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default ports
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"

# Load saved environment if it exists
if [ -f ".env.local" ]; then
    source .env.local
fi

# Check for required secrets
MISSING_SECRETS=""
[ -z "$JWT_SECRET" ] && MISSING_SECRETS="$MISSING_SECRETS JWT_SECRET"
[ -z "$ENCRYPTION_KEY" ] && MISSING_SECRETS="$MISSING_SECRETS ENCRYPTION_KEY"
[ -z "$GATEWAY_SECRET" ] && MISSING_SECRETS="$MISSING_SECRETS GATEWAY_SECRET"
[ -z "$POSTGRES_PASSWORD" ] && MISSING_SECRETS="$MISSING_SECRETS POSTGRES_PASSWORD"

if [ -n "$MISSING_SECRETS" ]; then
    echo "Error: Missing required secrets:$MISSING_SECRETS"
    echo ""
    echo "Run install.sh first for initial setup, or run:"
    echo "  ./scripts/setup.sh"
    exit 1
fi

# Export for docker compose
export JWT_SECRET ENCRYPTION_KEY GATEWAY_SECRET POSTGRES_PASSWORD
export HTTPS_PORT HTTP_PORT

case "${1:-}" in
    --stop)
        echo "Stopping Sanctuary..."
        docker compose --profile ai down
        echo "Sanctuary stopped."
        ;;
    --logs)
        docker compose logs -f
        ;;
    --with-ai)
        echo "Starting Sanctuary with bundled AI (Ollama)..."
        echo ""
        echo "Note: First-time AI setup will download the Ollama image (~1GB)."
        echo "      Models are downloaded separately when you pull them in settings."
        echo ""
        docker compose --profile ai up -d
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "AI Setup:"
        echo "  1. Go to Admin → AI Assistant"
        echo "  2. Enable AI Features"
        echo "  3. Click 'Detect' - it will find the bundled Ollama automatically"
        echo "  4. Pull a model (llama3.2:3b recommended for most systems)"
        ;;
    --rebuild)
        echo "Rebuilding and starting Sanctuary..."
        # Include ai profile in rebuild if ollama container exists (matches any project name)
        if docker ps -a --format '{{.Names}}' | grep -qE '.*-ollama-[0-9]+$'; then
            docker compose --profile ai up -d --build
        else
            docker compose up -d --build
        fi
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
    --help|-h)
        echo "Usage: ./start.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)      Start Sanctuary"
        echo "  --with-ai   Start with bundled AI (Ollama container)"
        echo "  --rebuild   Rebuild containers (use after updates)"
        echo "  --stop      Stop all services"
        echo "  --logs      View container logs"
        echo "  --help      Show this help"
        echo ""
        echo "Environment variables:"
        echo "  HTTPS_PORT  HTTPS port (default: 8443)"
        echo "  HTTP_PORT   HTTP redirect port (default: 8080)"
        echo ""
        echo "AI Setup:"
        echo "  Run './start.sh --with-ai' to enable bundled AI features."
        echo "  This starts an Ollama container - no external setup needed."
        ;;
    *)
        echo "Starting Sanctuary..."
        # Include ai profile if ollama container exists (matches any project name)
        if docker ps -a --format '{{.Names}}' | grep -qE '.*-ollama-[0-9]+$'; then
            docker compose --profile ai up -d
        else
            docker compose up -d
        fi
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
esac
