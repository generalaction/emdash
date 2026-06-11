# Testing And Validation

All paths are relative to `apps/emdash-desktop/`.

## Core Local Gate

Run these before merging (from the repo root or `apps/emdash-desktop/`):

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```

## Test Layout

- main-process tests: colocated in `src/main/core/**/*.test.ts`
- renderer unit tests: `src/renderer/tests/`
- renderer browser tests: `src/renderer/tests/browser/` (run via Playwright)

## Current Setup

- Vitest config is in `vitest.config.ts` (separate from the build config in `electron.vite.config.ts`).
- Five test projects:
  - `node` — `src/**/*.test.ts` excluding `_*` dirs, browser tests, migration tests, `*.db.test.ts`, and `src/main/db/legacy-port/**/*.test.ts`
  - `main-db` — `src/main/core/**/*.db.test.ts` and `src/main/db/legacy-port/**/*.test.ts` against real SQLite
  - `fixtures` — fixture generator, run via `pnpm run db:fixtures`
  - `migrations` — `src/main/db/tests/migrations/**`, run via `pnpm run test:migrations`
  - `browser` — `src/renderer/tests/browser/**/*.test.{ts,tsx}` via Playwright
- `pnpm run test` runs the `node`, `main-db`, `migrations`, and `browser` projects.
- Tests use per-file `vi.mock()` setup.
- Integration-style tests create temporary repos and worktrees in `os.tmpdir()`.

## CI Notes

- `.github/workflows/code-consistency-check.yml` currently enforces:
  - `pnpm run format:check`
  - `pnpm run typecheck`
  - `pnpm run lint`
- Tests are still expected locally before merging even though they are not enabled in that workflow yet.

## Focused Validation

- after IPC/RPC changes: rerun the affected Vitest file and confirm the controller is wired in `src/main/rpc.ts`
- after worktree or PTY changes: rerun the closest `src/main/core/` test files
- after schema changes: run `pnpm run db:fixtures` and `pnpm run test:migrations`
