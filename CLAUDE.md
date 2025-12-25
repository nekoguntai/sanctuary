# Sanctuary - Claude Code Instructions

## Docker Compose Commands

**IMPORTANT**: Always run docker compose commands WITHOUT inline environment variables.
The `.env` file in the project root contains all required secrets and configuration.

```bash
# CORRECT - relies on .env file
docker compose up -d
docker compose build
docker compose restart backend
docker compose logs -f backend

# WRONG - do NOT use inline env vars
# POSTGRES_PASSWORD="..." JWT_SECRET="..." docker compose up
```

Use `./start.sh` for common operations:
- `./start.sh` - Start all services
- `./start.sh --rebuild` - Rebuild and start
- `./start.sh --with-ai` - Start with Ollama
- `./start.sh --stop` - Stop all services

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
