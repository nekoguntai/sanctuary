#!/bin/bash
# Sanctuary - Environment exports for Umbrel

# Container IP addresses (assigned by Umbrel)
export APP_SANCTUARY_WEB_IP="10.21.22.50"
export APP_SANCTUARY_SERVER_IP="10.21.22.51"
export APP_SANCTUARY_DB_IP="10.21.22.52"
export APP_SANCTUARY_MIGRATE_IP="10.21.22.53"

# Generate a unique JWT secret for this installation
# This is generated once and persisted
JWT_SECRET_FILE="${EXPORTS_APP_DIR}/jwt_secret"
if [ ! -f "$JWT_SECRET_FILE" ]; then
  openssl rand -base64 32 | tr -d '=/+' | head -c 48 > "$JWT_SECRET_FILE"
fi
export APP_SANCTUARY_JWT_SECRET=$(cat "$JWT_SECRET_FILE")

# Port for accessing Sanctuary (via Umbrel's app proxy)
export APP_SANCTUARY_PORT="3010"

# Hidden service for Tor access (if configured)
SANCTUARY_HIDDEN_SERVICE_FILE="${EXPORTS_TOR_DATA_DIR}/app-sanctuary/hostname"
if [ -f "$SANCTUARY_HIDDEN_SERVICE_FILE" ]; then
  export APP_SANCTUARY_HIDDEN_SERVICE=$(cat "$SANCTUARY_HIDDEN_SERVICE_FILE")
else
  export APP_SANCTUARY_HIDDEN_SERVICE="notyetset.onion"
fi
