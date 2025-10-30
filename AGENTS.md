---
build:
  - npm run build
start:
  - npm run d
  - npm run dev
test:
  - npm run type-check
  - npm run lint
  - npx vitest run
ports:
  - 3000
env:
  required: []
  optional:
    TELEMETRY_ENABLED: Set to false before launch to disable analytics.
    EMDASH_PLAN_MODE: Set to 1 to force read-only plan policy.
    EMDASH_PLAN_FILE: Absolute path to the active plan policy file.
default_branch: main
---

## Quick Start
1. `nvm use` (or install Node.js 22.20.0 manually) to match the enforced engine range.
2. `npm run d` for a one-shot install plus dev boot (runs `npm install`, rebuilds native deps, and launches Electron+Vite).
3. If you prefer manual steps: `npm install` then `npm run dev` (spawns Electron after the Vite dev server on port 3000).
4. Hit segmentation faults? Run `npm run rebuild`; as a last resort use `npm run reset`.

## Test & Quality Gates
1. `npm run type-check`
2. `npm run lint`
3. `npx vitest run` (Vitest is configured via `vite.config.ts::test` and picks up `src/**/*.test.ts`).

## Tiny Repo Map
- `src/main/` – Electron main process, IPC, DB wiring, updater.
- `src/renderer/` – React UI (Vite client), Tailwind views, hooks.
- `src/shared/` – Cross-process utilities, container config helpers, tests.
- `drizzle/` – Generated SQL migrations; edit carefully and regenerate via Drizzle CLI if schema changes.
- `build/` – Electron Builder assets (entitlements, icons); breaking builds if altered incorrectly.
- `scripts/emdash-run.ts` – CLI helper for container runs; keep behavior backward compatible.

## Guardrails
**Do**
- Stay on feature branches; default branch is `main` and must remain untouched.
- Limit edits to `src/renderer/**`, `src/shared/**`, `src/main/services/**`, and docs unless the task explicitly targets other areas.
- Run the quality commands above before raising a PR.
- Mask or omit any API keys; use `.env.example` patterns instead of committing secrets.

**Don’t**
- Push directly to `main` or rewrite history on shared branches.
- Modify `drizzle/**`, `drizzle.config.ts`, `build/**`, or `package.json` without prior approval—these impact migrations, signing, and packaging.
- Commit generated SQLite data or worktree artifacts; DB files live outside the repo by design.
- Disable telemetry globally in code; use `TELEMETRY_ENABLED=false` at runtime if needed.

## Pre-PR Checklist
- [ ] Branch off `main` and ensure `git status` is clean (no stray worktree artifacts).
- [ ] `npm run type-check`
- [ ] `npm run lint`
- [ ] `npx vitest run`
- [ ] `npm run build`
- [ ] Update screenshots/docs when UI or behavior changes.
