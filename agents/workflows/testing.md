# Testing And Validation

## Core Local Gate

Run these before merging:

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
- Two test projects:
  - `node` — all `src/**/*.test.ts` files excluding `_*` dirs and browser tests
  - `browser` — `src/renderer/tests/browser/**/*.test.{ts,tsx}` via `@vitest/browser-playwright`
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
- after docs changes: run `pnpm run docs:build`
