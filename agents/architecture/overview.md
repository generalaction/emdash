# Architecture Overview

## Process Model

- `src/main/`: Electron main process, IPC, services, database, PTY orchestration, updater, SSH, integrations
- `src/renderer/`: React UI, task views, terminals, diff review, settings, skills, MCP, kanban
- `src/shared/`: provider registry, IPC helpers, shared MCP/diff/SSH/task utilities

## Boot Sequence

`src/main/entry.ts` -> `src/main/main.ts` -> window/app lifecycle -> IPC registration -> renderer

- `entry.ts` installs runtime alias resolution for compiled CommonJS output and sets the app name early.
- `main.ts` loads `.env`, normalizes PATH, initializes shell-derived env, database, updater, SSH, worktree pool, and IPC.
- `preload.ts` exposes `window.electronAPI` via `contextBridge`.

## Read Next

- Main process details: `main-process.md`
- Renderer details: `renderer.md`
- Shared modules and provider registry: `shared.md`
