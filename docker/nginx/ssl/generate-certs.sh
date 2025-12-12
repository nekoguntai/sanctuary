#!/bin/bash
# Generate self-signed SSL certificates for Sanctuary
# For production, replace these with real certificates from Let's Encrypt or your CA

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERT_DIR="${SCRIPT_DIR}"

# Certificate details
DOMAIN="${1:-localhost}"
DAYS=365

echo "Generating self-signed SSL certificate for: ${DOMAIN}"

# Generate private key and certificate
openssl req -x509 -nodes -days ${DAYS} -newkey rsa:2048 \
  -keyout "${CERT_DIR}/privkey.pem" \
  -out "${CERT_DIR}/fullchain.pem" \
  -subj "/CN=${DOMAIN}/O=Sanctuary/C=US" \
  -addext "subjectAltName=DNS:${DOMAIN},DNS:*.${DOMAIN},IP:127.0.0.1,IP:::1"

if [ $? -eq 0 ]; then
  echo "Certificates generated successfully:"
  echo "  - ${CERT_DIR}/fullchain.pem"
  echo "  - ${CERT_DIR}/privkey.pem"
  echo ""
  echo "Note: For local development, you may need to add the certificate to your browser's trusted store."
  echo "      Or use 'mkcert' for locally-trusted certificates: https://github.com/FiloSottile/mkcert"
else
  echo "Failed to generate certificates"
  exit 1
fi
