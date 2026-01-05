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
- `server/ARCHITECTURE.md` - Server architecture patterns and infrastructure

## Server Architecture

The server uses established patterns documented in `server/ARCHITECTURE.md`. Key patterns:

| Pattern | Location | Purpose |
|---------|----------|---------|
| Service Registry | `services/registry.ts` | Dependency injection with mock support |
| Repository Layer | `repositories/*.ts` | Data access abstraction (never use Prisma directly in routes/services) |
| Service Errors | `services/errors.ts` | Domain errors that map to HTTP status codes |
| Distributed Locking | `infrastructure/distributedLock.ts` | Multi-instance coordination |
| Config Centralization | `config/index.ts` | All settings from environment variables |
| Async Utilities | `utils/async.ts` | Retry, timeout, concurrency control |

Before recommending architectural improvements, check if the pattern already exists.

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
The codebase uses `text-[9px]`, `text-[10px]`, and `text-[11px]` for compact UI elements like health block counters, badge labels, and advanced options labels. These are intentional - `text-xs` (12px) would be too large for these tight spaces. Do not "fix" these to use named Tailwind sizes.

## Git Commits & Pre-commit Hooks

The repository has pre-commit hooks that run AI agents to analyze changes:
- **Test Coverage Analysis** - checks if tests need to be added/updated/removed
- **UI Consistency & Style Analysis** - validates dark mode, patterns, and style consistency
- **Architecture & Scalability Analysis** - reviews for scalability, cleanup, and memory issues
- **Stability & Perpetual Operation** - validates long-running operation patterns
- **Code Documentation Analysis** - ensures security-critical and complex code is documented

**IMPORTANT**: Always run `git commit` with full output visible (not in background) so the agent feedback can be reviewed before pushing. Each agent will end with one of:
- ✅ **RECOMMEND PROCEED** - no issues found
- ⚠️ **SUGGEST REVIEW** - minor concerns worth considering
- ❌ **RECOMMEND STOP** - significant issues that should be addressed

Review the agent recommendations and address any concerns before pushing.

## Extensibility & Perpetual Operation Principles

When implementing features, always consider extensibility and long-running operation patterns. This project is designed to run continuously for extended periods.

### Extensibility Guidelines

1. **Use config objects over hard-coded values**
   ```typescript
   // GOOD - extensible configuration
   const ACCOUNT_TYPE_CONFIG: Record<string, AccountTypeInfo> = {
     'single_sig:native_segwit': { title: 'Native SegWit', ... },
     // Easy to add new types
   };

   // BAD - hard-coded switch statements
   switch(type) { case 'single_sig': ...; case 'multisig': ...; }
   ```

2. **Design for multiple account/wallet/script types from the start**
   - Don't assume single-sig only or native_segwit only
   - Support multisig (m/48' BIP-48) and single-sig (m/44'/49'/84'/86') paths
   - Handle P2WSH, P2SH-P2WSH, P2TR, P2PKH, P2SH-P2WPKH script types

3. **Filter and validate at boundaries**
   - Filter devices by capability (e.g., show only multisig-capable devices for multisig wallet creation)
   - Validate imported data against device fingerprints
   - Show helpful messages when data is missing or incompatible

4. **Reuse parsing and import patterns**
   - Use `parseDeviceJson()` from `services/deviceParsers` for device imports
   - Use the Scanner component pattern from `ConnectDevice.tsx` for QR codes
   - Use UR decoders (`URRegistryDecoder`, `BytesURDecoder`) for animated QR codes

5. **Handle conflicts gracefully**
   - Check for existing data before adding (device fingerprints, derivation paths)
   - Offer merge options when duplicates are detected
   - Warn about security implications (xpub mismatches)

### Perpetual Operation Guidelines

1. **Clean up resources properly**
   - Reset all state when dialogs close
   - Clear decoder refs (`urDecoderRef.current = null`)
   - Stop cameras and timers on component unmount

2. **Avoid memory leaks**
   - Don't store unbounded lists in state
   - Use pagination for large data sets
   - Clear caches periodically

3. **Handle reconnection gracefully**
   - WebSocket connections should auto-reconnect
   - Hardware wallet connections may need user re-initiation
   - Show clear status when connections are lost

4. **Design for server restarts**
   - Use distributed locks for multi-instance coordination
   - Don't rely on in-memory state across requests
   - Store critical state in database

### Code Organization Patterns

| Pattern | Example | Purpose |
|---------|---------|---------|
| Config objects | `ACCOUNT_TYPE_CONFIG` | Extensible type definitions |
| Helper functions | `hasCompatibleAccount()` | Reusable logic for filtering |
| Process functions | `processImportedAccounts()` | Handle imports with conflict detection |
| Reset functions | `resetImportState()` | Clean up all related state |
| useMemo for filtering | `compatibleDevices` | Efficient derived state |
