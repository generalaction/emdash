# Quickstart

## Toolchain

- Node: `22.20.0` from `.nvmrc`
- Package manager: `pnpm@10.28.2`
- Electron app root: this repo

## Core Commands

```bash
pnpm run d
pnpm run dev
pnpm run dev:main
pnpm run dev:renderer
pnpm run build
pnpm run rebuild
pnpm run reset
```

## Validation Commands

```bash
pnpm run format
pnpm run lint
pnpm run type-check
pnpm exec vitest run
```

## Important Notes

- `pnpm test` is a shortcut for `vitest run`.
- After native dependency changes (`sqlite3`, `node-pty`, `keytar`), run `pnpm run rebuild`.
- Husky and lint-staged run formatting and linting on staged files during commit.
