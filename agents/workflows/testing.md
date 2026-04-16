# Testing And Validation

## Core Local Gate

Run these before merging:

```bash
pnpm run format
pnpm run lint
pnpm run type-check
pnpm exec vitest run
```

## Test Layout

- main-process tests: `src/test/main/`
- renderer-focused tests: `src/test/renderer/`
- utility tests: `src/main/utils/__tests__/`

## Current Setup

- Vitest config is in `vite.config.ts`.
- Tests run with `environment: 'node'`.
- Included test files match `src/**/*.test.ts`.
- Tests use per-file `vi.mock()` setup.
- Integration-style tests create temporary repos and worktrees in `os.tmpdir()`.

## CI Notes

- `.github/workflows/code-consistency-check.yml` currently enforces:
  - `pnpm run format:check`
  - `pnpm run type-check`
  - `pnpm exec vitest run`
- Lint is still expected locally even though it is not enabled in that workflow yet.

## Focused Validation

- after IPC changes: rerun the affected Vitest file and confirm `electron-api.d.ts`
- after worktree or PTY changes: rerun the closest main-process service tests
