# Sanctuary - Claude Code Instructions

## Docker Commands

**NEVER run `npm run dev/preview/start` or `npx vite` on the host.** All services run inside Docker only.

Use `./start.sh` for building and running. Never use inline environment variables with docker compose.

```bash
./start.sh              # Start all services
./start.sh --rebuild    # Rebuild containers (use after code changes)
./start.sh --stop       # Stop all services
```

## Server Architecture

Read `server/ARCHITECTURE.md` before recommending architectural improvements — the pattern likely already exists. Never use Prisma directly in routes/services; use the repository layer.

## Theme System (Dark Mode Gotcha)

The theme uses **inverted color scales** for dark mode in `primary`, `warning`, `success`, `sent`, and `shared` palettes. Low numbers (50-200) = dark, high numbers (800-950) = light. Opposite of standard Tailwind.

```tsx
// CORRECT: dark:bg-primary-100 is dark, dark:text-primary-700 is light
className="bg-primary-600 text-white dark:bg-primary-100 dark:text-primary-700"

// WRONG: dark:bg-primary-950 is white in dark mode
className="bg-primary-600 text-white dark:bg-primary-950 dark:text-primary-200"
```

NOT inverted (standard Tailwind): `sanctuary-*`, `emerald-*`, `rose-*`.

`text-[9px]`, `text-[10px]`, `text-[11px]` are intentional for compact UI. Do not replace with named Tailwind sizes.

## Git & Versions

Run `git commit` in foreground — pre-commit hooks run AI agents whose feedback must be reviewed.

Versions must sync across `package.json`, `server/package.json`, `gateway/package.json`, `sanctuary/umbrel-app.yml`. Use `./scripts/bump-version.sh`. Never bump versions for CI failures — fix on the same version.

Release: bump + RC tag → verify CI with `gh run list` → release tag. If CI fails: fix, delete failed tag, re-tag same version.

## TypeScript Rules

- **Never** `catch (error: any)` — use `catch (error)` + `getErrorMessage()` from `utils/errors`
- **Never** raw `JSON.parse` for settings/user data — use `safeJsonParse()` from `utils/safeJson`
- **Never** `console.log` — use `createLogger()` from `utils/logger`
- **Never** empty catch blocks — at minimum `log.debug()`
- **Never** `@ts-ignore` — use `@ts-expect-error` with explanation if needed
- Use `isPrismaError()` from `utils/errors` for Prisma error handling
