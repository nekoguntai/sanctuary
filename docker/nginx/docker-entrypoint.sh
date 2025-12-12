#!/bin/sh
set -e

# Default values for environment variables
export BACKEND_HOST=${BACKEND_HOST:-backend}
export BACKEND_PORT=${BACKEND_PORT:-3001}
export ENABLE_SSL=${ENABLE_SSL:-false}

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
envsubst '${BACKEND_HOST} ${BACKEND_PORT}' < "$TEMPLATE" > /etc/nginx/conf.d/default.conf

echo "Nginx configuration generated with:"
echo "  BACKEND_HOST: $BACKEND_HOST"
echo "  BACKEND_PORT: $BACKEND_PORT"
echo "  ENABLE_SSL: $ENABLE_SSL"

# Execute the main command
exec "$@"
