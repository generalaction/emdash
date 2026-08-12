# Architecture Overview

All paths are relative to `apps/emdash-desktop/`.

## Process Model

- `src/main/`: Electron main process — app lifecycle, RPC controllers, domain services, database, PTY orchestration, updater, SSH
- `src/entry/preload.ts`: minimal Electron bridge for the Wire port and file-path lookup
- `src/renderer/`: React composition shell and shared browser infrastructure
- `src/core/`: vertical slices with portable APIs, Node implementations, browser UI, contributions,
  and manifests

## Boot Sequence

`src/entry/main.ts` → phased bootstrap → Wire gateway → window creation → renderer

- `src/entry/main.ts` — Electron entry point; runs the phased bootstrap in `src/main/bootstrap/` (environment, database, window creation, recovery).
- `src/main/gateway/desktop-wire.ts` — Serves renderer-main Wire traffic from the contract assembled in `src/core/manifests/shared/desktop-wire-contract.ts` and the slice controllers aggregated in `src/core/manifests/node/controllers.ts`.
- `src/entry/preload.ts` — Exposes only `requestWirePort` and `getPathForFile` via `contextBridge`.
- `src/core/primitives/wire/browser/connection.ts` — Seeded Wire connection seam; the renderer bootstrap seeds it once at startup, and each slice builds its typed domain client on it.

## Build Tooling

- `electron.vite.config.ts` — electron-vite config for main, preload, and renderer builds.
- `vitest.config.ts` — Vitest config with five test projects: `node`, `main-db`, `fixtures`, `migrations`, and `browser` (Playwright-backed renderer tests).
- Single `tsconfig.json` (in `apps/emdash-desktop/`) for all app targets.

## Read Next

- Main process details: `main-process.md`
- Renderer details: `renderer.md`
- Shared modules and provider registry: `shared.md`
