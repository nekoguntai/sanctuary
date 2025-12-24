#!/bin/bash
# ============================================
# Sanctuary Bitcoin Wallet - Start Script
# ============================================
# Use this script to start Sanctuary after initial installation.
#
# Usage:
#   ./start.sh                  # Start with defaults
#   ./start.sh --with-ai        # Start with bundled AI (Ollama)
#   ./start.sh --with-monitoring # Start with monitoring (Grafana/Loki)
#   ./start.sh --with-tor       # Start with Tor proxy
#   ./start.sh --rebuild        # Rebuild containers (after updates)
#   ./start.sh --stop           # Stop all services
#   ./start.sh --logs           # View logs
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Default ports
HTTPS_PORT="${HTTPS_PORT:-8443}"
HTTP_PORT="${HTTP_PORT:-8080}"

# Load environment from .env (Docker Compose's default file)
# This ensures start.sh and docker compose use the same values
if [ -f ".env" ]; then
    set -a  # Export all variables
    source .env
    set +a
elif [ -f ".env.local" ]; then
    # Fallback to .env.local for backwards compatibility
    set -a  # Export all variables
    source .env.local
    set +a
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
export HTTPS_PORT HTTP_PORT ENABLE_MONITORING ENABLE_TOR

case "${1:-}" in
    --stop)
        echo "Stopping Sanctuary..."
        # Stop monitoring stack if running
        if docker ps --format '{{.Names}}' | grep -qE '.*-(grafana|loki|promtail)'; then
            docker compose -f docker-compose.yml -f docker-compose.monitoring.yml --profile ai down
        else
            docker compose --profile ai down
        fi
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
    --with-monitoring)
        echo "Starting Sanctuary with monitoring stack (Grafana/Loki/Promtail)..."
        echo ""
        echo "Note: First-time setup will download monitoring images (~500MB total)."
        echo ""
        docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "Monitoring:"
        echo "  Grafana: http://localhost:${GRAFANA_PORT:-3000}"
        echo "    Username: admin"
        echo "    Password: (your GRAFANA_PASSWORD or ENCRYPTION_KEY)"
        echo ""
        echo "  Dashboards are pre-configured with Sanctuary logs."
        ;;
    --with-tor)
        echo "Starting Sanctuary with Tor proxy..."
        echo ""
        echo "Note: First-time setup will download the Tor image (~50MB)."
        echo ""
        docker compose -f docker-compose.yml -f docker-compose.tor.yml up -d
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        echo ""
        echo "Tor Setup:"
        echo "  1. Go to Admin → Node Configuration"
        echo "  2. Enable 'Proxy / Tor'"
        echo "  3. Select 'Tor Container' preset (tor:9050)"
        echo "  4. Save and test connection"
        ;;
    --rebuild)
        echo "Rebuilding and starting Sanctuary..."
        # Detect which stacks are running (check containers or env preference)
        HAS_AI=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-ollama-[0-9]+$' && echo "yes" || echo "no")
        HAS_MONITORING=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-(grafana|loki|promtail)' && echo "yes" || echo "no")
        HAS_TOR=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-tor' && echo "yes" || echo "no")
        # Also check env preference from install
        [ "$ENABLE_MONITORING" = "yes" ] && HAS_MONITORING="yes"
        [ "$ENABLE_TOR" = "yes" ] && HAS_TOR="yes"

        COMPOSE_FILES="-f docker-compose.yml"
        [ "$HAS_MONITORING" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
        [ "$HAS_TOR" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tor.yml"

        if [ "$HAS_AI" = "yes" ]; then
            docker compose $COMPOSE_FILES --profile ai up -d --build
        else
            docker compose $COMPOSE_FILES up -d --build
        fi
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
    --help|-h)
        echo "Usage: ./start.sh [option]"
        echo ""
        echo "Options:"
        echo "  (none)            Start Sanctuary"
        echo "  --with-ai         Start with bundled AI (Ollama container)"
        echo "  --with-monitoring Start with monitoring (Grafana/Loki/Promtail)"
        echo "  --with-tor        Start with Tor proxy for privacy"
        echo "  --rebuild         Rebuild containers (use after updates)"
        echo "  --stop            Stop all services"
        echo "  --logs            View container logs"
        echo "  --help            Show this help"
        echo ""
        echo "Environment variables:"
        echo "  HTTPS_PORT    HTTPS port (default: 8443)"
        echo "  HTTP_PORT     HTTP redirect port (default: 8080)"
        echo "  GRAFANA_PORT  Grafana port (default: 3000)"
        echo ""
        echo "AI Setup:"
        echo "  Run './start.sh --with-ai' to enable bundled AI features."
        echo "  This starts an Ollama container - no external setup needed."
        echo ""
        echo "Monitoring:"
        echo "  Run './start.sh --with-monitoring' to enable monitoring."
        echo "  Access Grafana at http://localhost:3000 (admin / your ENCRYPTION_KEY)"
        echo ""
        echo "Tor Privacy:"
        echo "  Run './start.sh --with-tor' to enable Tor proxy."
        echo "  Then enable in Admin → Node Configuration → Proxy / Tor."
        ;;
    *)
        echo "Starting Sanctuary..."
        # Detect which stacks were previously running (check containers or env preference)
        HAS_AI=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-ollama-[0-9]+$' && echo "yes" || echo "no")
        HAS_MONITORING=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-(grafana|loki|promtail)' && echo "yes" || echo "no")
        HAS_TOR=$(docker ps -a --format '{{.Names}}' | grep -qE '.*-tor' && echo "yes" || echo "no")
        # Also check env preference from install
        [ "$ENABLE_MONITORING" = "yes" ] && HAS_MONITORING="yes"
        [ "$ENABLE_TOR" = "yes" ] && HAS_TOR="yes"

        COMPOSE_FILES="-f docker-compose.yml"
        [ "$HAS_MONITORING" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.monitoring.yml"
        [ "$HAS_TOR" = "yes" ] && COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.tor.yml"

        if [ "$HAS_AI" = "yes" ]; then
            docker compose $COMPOSE_FILES --profile ai up -d
        else
            docker compose $COMPOSE_FILES up -d
        fi
        echo ""
        echo "Sanctuary is running at https://localhost:${HTTPS_PORT}"
        ;;
esac
