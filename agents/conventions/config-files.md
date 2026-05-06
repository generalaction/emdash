# Config Files And Repo Rules

## Key Files

- `package.json`
- `electron.vite.config.ts`
- `vitest.config.ts`
- `tsconfig.json`
- `drizzle.config.ts`
- `.emdash.json`
- `.nvmrc`
- `.husky/`
- `.github/workflows/`
- `flake.nix`

## Repo Rules

- avoid editing `dist/`, `release/`, and `build/` unless the task is explicitly about packaging or signing
- the docs app in `docs/` is separate from the Electron renderer
- update the narrowest relevant page in `agents/` instead of growing `AGENTS.md`
