#!/bin/sh
set -e

# =============================================
# Sanctuary Nginx Entrypoint - HTTPS ONLY
# =============================================
#
# IMPORTANT: This application is designed to run HTTPS-ONLY.
# ENABLE_SSL should always be "true" in production.
#
# HTTPS is required for:
# - WebUSB API (hardware wallet support via browser)
# - Secure credential transmission
# - Modern browser security requirements
#
# HTTP on port 80 only serves redirects to HTTPS.
# =============================================

# Default values for environment variables
export BACKEND_HOST=${BACKEND_HOST:-backend}
export BACKEND_PORT=${BACKEND_PORT:-3001}
export ENABLE_SSL=${ENABLE_SSL:-true}  # Default to true - HTTPS only
export HTTPS_REDIRECT_PORT=${HTTPS_REDIRECT_PORT:-443}

# Choose template based on SSL setting
if [ "$ENABLE_SSL" = "true" ] && [ -f /etc/nginx/ssl/fullchain.pem ] && [ -f /etc/nginx/ssl/privkey.pem ]; then
    TEMPLATE="/etc/nginx/templates/default-ssl.conf.template"
    echo "SSL enabled - using HTTPS configuration"
else
    TEMPLATE="/etc/nginx/templates/default.conf.template"
    if [ "$ENABLE_SSL" = "true" ]; then
        echo "Warning: SSL enabled but certificates not found, falling back to HTTP"
    fi
fi

# Substitute environment variables in nginx config template
envsubst '${BACKEND_HOST} ${BACKEND_PORT} ${HTTPS_REDIRECT_PORT}' < "$TEMPLATE" > /etc/nginx/conf.d/default.conf

echo "Nginx configuration generated with:"
echo "  BACKEND_HOST: $BACKEND_HOST"
echo "  BACKEND_PORT: $BACKEND_PORT"
echo "  ENABLE_SSL: $ENABLE_SSL"
echo "  HTTPS_REDIRECT_PORT: $HTTPS_REDIRECT_PORT"

# Execute the main command
exec "$@"
