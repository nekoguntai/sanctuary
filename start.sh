#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Start Script
# ============================================
# Use this script to start Sanctuary after initial installation.
#
# Usage:
#   ./start.sh              # Start with defaults
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

# Check for JWT_SECRET
if [ -z "$JWT_SECRET" ]; then
    echo "Error: JWT_SECRET not set."
    echo ""
    echo "Either:"
    echo "  1. Run install.sh first for initial setup"
    echo "  2. Or set JWT_SECRET manually:"
    echo "     export JWT_SECRET=your-secret-here && ./start.sh"
    exit 1
fi

case "${1:-}" in
    --stop)
        echo "Stopping Sanctuary..."
        docker compose down
        echo "Sanctuary stopped."
        ;;
    --logs)
        docker compose logs -f
        ;;
    --rebuild)
        echo "Rebuilding and starting Sanctuary..."
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" JWT_SECRET="$JWT_SECRET" \
            docker compose up -d --build
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
    --help|-h)
        echo "Usage: ./start.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)      Start Sanctuary"
        echo "  --rebuild   Rebuild containers (use after updates)"
        echo "  --stop      Stop all services"
        echo "  --logs      View container logs"
        echo "  --help      Show this help"
        echo ""
        echo "Environment variables:"
        echo "  HTTPS_PORT  HTTPS port (default: 8443)"
        echo "  HTTP_PORT   HTTP redirect port (default: 8080)"
        ;;
    *)
        echo "Starting Sanctuary..."
        HTTPS_PORT="$HTTPS_PORT" HTTP_PORT="$HTTP_PORT" JWT_SECRET="$JWT_SECRET" \
            docker compose up -d
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
esac
