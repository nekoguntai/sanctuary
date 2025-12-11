# Sanctuary Docker Deployment

This guide explains how to deploy Sanctuary using Docker and Docker Compose.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Network                           │
│                                                              │
│  ┌──────────────┐   ┌──────────────┐   ┌─────────────────┐  │
│  │   Frontend   │   │   Backend    │   │    PostgreSQL   │  │
│  │   (nginx)    │──▶│   (node)     │──▶│                 │  │
│  │    :80       │   │    :3001     │   │     :5432       │  │
│  └──────────────┘   └──────────────┘   └─────────────────┘  │
│         │                                      │             │
│         ▼                                      ▼             │
│    [exposed]                              [volume]           │
└─────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Prerequisites

- Docker Engine 20.10+
- Docker Compose V2

### 2. Configuration

```bash
# Copy the example environment file
cp .env.docker.example .env

# Edit the configuration (REQUIRED: change JWT_SECRET and POSTGRES_PASSWORD)
nano .env
```

**Important**: You MUST change these values before deployment:
- `JWT_SECRET` - Generate with: `openssl rand -base64 64`
- `POSTGRES_PASSWORD` - Use a strong, unique password

### 3. Build and Run

```bash
# Build and start all services
docker compose up -d --build

# Watch the logs
docker compose logs -f

# Check service status
docker compose ps
```

### 4. Access the Application

- **Frontend**: http://localhost (or your configured port)
- **API Health Check**: http://localhost/api/v1/health

## Commands

### Start/Stop

```bash
# Start services
docker compose up -d

# Stop services
docker compose down

# Stop and remove volumes (CAUTION: deletes database!)
docker compose down -v
```

### View Logs

```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f backend
docker compose logs -f frontend
docker compose logs -f postgres
```

### Database Operations

```bash
# Run migrations manually
docker compose run --rm migrate

# Access PostgreSQL directly
docker compose exec postgres psql -U sanctuary -d sanctuary

# Create a database backup
docker compose exec postgres pg_dump -U sanctuary sanctuary > backup.sql

# Restore from backup
cat backup.sql | docker compose exec -T postgres psql -U sanctuary sanctuary
```

### Rebuild Services

```bash
# Rebuild all services
docker compose build --no-cache

# Rebuild specific service
docker compose build --no-cache backend
```

## Production Deployment

For production, use the production override file:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

This adds:
- Resource limits (CPU/memory)
- Security hardening (read-only filesystem, no new privileges)
- Optimized restart policies

### SSL/TLS with Let's Encrypt

For HTTPS in production, you have several options:

1. **Reverse Proxy (Recommended)**: Put Sanctuary behind a reverse proxy like Traefik, Caddy, or nginx-proxy that handles SSL termination.

2. **Cloudflare Tunnel**: Use Cloudflare Tunnel for zero-config HTTPS.

3. **Manual SSL**: Mount SSL certificates into the frontend container and modify nginx config.

Example with Traefik labels (add to frontend service):

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.sanctuary.rule=Host(`sanctuary.yourdomain.com`)"
  - "traefik.http.routers.sanctuary.tls.certresolver=letsencrypt"
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker compose logs backend

# Common issues:
# - Database not ready: Wait for postgres healthcheck
# - Missing JWT_SECRET: Add to .env file
# - Port already in use: Change FRONTEND_PORT in .env
```

### Database connection issues

```bash
# Verify postgres is running
docker compose ps postgres

# Test connection from backend
docker compose exec backend wget -q -O- http://localhost:3001/health
```

### Reset everything

```bash
# Stop all containers and remove volumes
docker compose down -v

# Remove all images
docker compose down --rmi all

# Start fresh
docker compose up -d --build
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `FRONTEND_PORT` | `80` | Port to expose the frontend |
| `POSTGRES_USER` | `sanctuary` | PostgreSQL username |
| `POSTGRES_PASSWORD` | - | PostgreSQL password (required) |
| `POSTGRES_DB` | `sanctuary` | PostgreSQL database name |
| `JWT_SECRET` | - | Secret for JWT tokens (required) |
| `JWT_EXPIRES_IN` | `7d` | JWT token expiration |
| `BITCOIN_NETWORK` | `mainnet` | Bitcoin network to use |
| `ELECTRUM_HOST` | `electrum.blockstream.info` | Electrum server host |
| `ELECTRUM_PORT` | `50002` | Electrum server port |
| `ELECTRUM_PROTOCOL` | `ssl` | Electrum protocol (ssl/tcp) |

## Security Considerations

1. **Never expose PostgreSQL port** to the internet
2. **Use strong passwords** for database and JWT secret
3. **Keep Docker and images updated** for security patches
4. **Use HTTPS in production** with proper SSL certificates
5. **Consider running your own Electrum server** for privacy
6. **Regular backups** of the PostgreSQL volume

## Updating

```bash
# Pull latest code
git pull

# Rebuild and restart
docker compose up -d --build

# Run any new migrations
docker compose run --rm migrate
```
