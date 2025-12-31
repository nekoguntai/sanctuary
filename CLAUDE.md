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
- `gateway/` - Mobile API gateway (Express)
- `shared/` - Shared code across frontend, backend, and gateway
  - `types/` - Shared TypeScript types (logger, websocket, bitcoin)
  - `constants/` - Shared constants (bitcoin patterns)
  - `utils/` - Shared utilities (bitcoin conversion, error handling)
- `components/` - React frontend components
- `src/` - Frontend source (api clients, types)
- `services/` - Frontend services (hardware wallets)
- `contexts/` - React contexts
- `hooks/` - React hooks
- `utils/` - Frontend utilities

## Key Files

- `.env` - Environment configuration (auto-loaded by docker compose)
- `docker-compose.yml` - Main container orchestration
- `server/prisma/schema.prisma` - Database schema

## Theme System & Dark Mode Colors

**IMPORTANT**: The theme system uses **inverted color scales** for dark mode in `primary`, `warning`, and `success` palettes.

In dark mode, the color values are flipped:
- **Low numbers (50, 100, 200)** = dark colors
- **High numbers (800, 900, 950)** = light colors

This is the opposite of standard Tailwind where 50 is always light and 950 is always dark.

### Example: primary colors in dark mode
```
primary-50:  #1a1917  (almost black)
primary-100: #2b261f  (dark brown)
primary-950: #ffffff  (white)
```

### Correct dark mode styling for badges/tags
```tsx
// For dark background + light text in dark mode:
className="bg-primary-600 text-white dark:bg-primary-100 dark:text-primary-700"
//                                      ^^^ low = dark    ^^^ high = light

// WRONG - this gives white background in dark mode:
className="bg-primary-600 text-white dark:bg-primary-950 dark:text-primary-200"
```

### Colors that follow standard Tailwind (NOT inverted)
- `sanctuary-*` - background grays
- `emerald-*`, `rose-*` - status colors

### Semantic color usage
- `primary-*` - owner badges, primary actions (inverted in dark mode)
- `warning-*` - signer badges, warnings (inverted in dark mode)
- `success-*` - confirmations, healthy status (inverted in dark mode)
- `sent-*` - sent transactions (violet/purple, inverted in dark mode)
- `shared-*` - shared wallet/device indicators (teal, inverted in dark mode)

See `themes/sanctuary/index.ts` for the full color definitions.

### Intentional arbitrary text sizes
The codebase uses `text-[9px]` and `text-[10px]` for compact UI elements like health block counters and badge labels. These are intentional - `text-xs` (12px) would be too large for these tight spaces. Do not "fix" these to use named Tailwind sizes.

## Git Commits & Pre-commit Hooks

The repository has pre-commit hooks that run AI agents to analyze changes:
- **Test Coverage Analysis** - checks if tests need to be added/updated/removed
- **UI Consistency & Style Analysis** - validates dark mode, patterns, and style consistency
- **Architecture & Scalability Analysis** - reviews for scalability, cleanup, and memory issues

**IMPORTANT**: Always run `git commit` with full output visible (not in background) so the agent feedback can be reviewed before pushing. Each agent will end with one of:
- ✅ **RECOMMEND PROCEED** - no issues found
- ⚠️ **SUGGEST REVIEW** - minor concerns worth considering
- ❌ **RECOMMEND STOP** - significant issues that should be addressed

Review the agent recommendations and address any concerns before pushing.
