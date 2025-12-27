# Sanctuary - Claude Code Instructions

## Docker Compose Commands

**IMPORTANT**: Always use `./start.sh` for building and running containers. This ensures proper environment setup and avoids issues with inline variables.

### Preferred: Use start.sh

```bash
./start.sh              # Start all services
./start.sh --rebuild    # Rebuild ALL containers and start (use this after code changes)
./start.sh --with-ai    # Start with Ollama AI
./start.sh --stop       # Stop all services
```

### Direct docker compose (if needed)

When using docker compose directly, NEVER use inline environment variables:

```bash
# CORRECT - relies on .env file
docker compose up -d
docker compose build
docker compose restart backend
docker compose logs -f backend

# WRONG - do NOT use inline env vars
# POSTGRES_PASSWORD="..." JWT_SECRET="..." docker compose up
```

## Project Structure

- `server/` - Backend API (Express + Prisma)
- `components/` - React frontend components
- `src/` - Frontend source (api clients, types)
- `services/` - Frontend services (hardware wallets)
- `contexts/` - React contexts
- `hooks/` - React hooks
- `utils/` - Shared utilities

## Key Files

- `.env` - Environment configuration (auto-loaded by docker compose)
- `docker-compose.yml` - Main container orchestration
- `server/prisma/schema.prisma` - Database schema
