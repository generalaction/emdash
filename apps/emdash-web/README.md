# Emdash Web

A self-hosted web frontend for Emdash: it runs the complete desktop backend
(database, runtime workers, services, and the full wire controller bundle)
inside a plain Node process, exposes it over WebSocket, and serves a browser
build of the renderer — the UI is the same one the desktop app ships.

## Architecture

```
Browser (the desktop renderer, React 19 + Tailwind + xterm + Monaco)
   │  WebSocket /ws?token=… (streamTransport framing: JSON + binary chunks)
   ▼
emdash-web Node server
   ├─ bootDatabase / bootInfrastructure / bootRuntimes / bootServices
   ├─ bootControllers (the same controller set the desktop gateway serves)
   ├─ 16 runtime workers (git / terminals / tui-agents / files / …, forked)
   └─ static hosting for dist/web
```

The desktop code is reused unchanged; the differences are exactly three:

1. The `electron` module is aliased to `server/shim/electron.ts` at build
   time (paths, dialogs, tray, and other desktop-only surfaces are stubbed).
2. The Electron MessagePort transport is replaced by a WebSocket speaking
   the same framed stream protocol the workspace-server uses.
3. The renderer bootstrap swaps `seedDesktopWire` for `seedWebWire` and
   installs a no-op `window.electronAPI` shim; the local-directory selector
   is overridden with a manual path input (validated live via
   `inspectProjectPath`).

## Build

From the monorepo root:

```bash
pnpm install
# Shared packages, if not built yet:
for p in shared wire theme ui chat-ui core plugins; do (cd packages/$p && pnpm run build); done

cd apps/emdash-web
pnpm build          # server + workers (esbuild) + renderer (vite)
```

> If `better-sqlite3` reports an ABI mismatch after install (it may fetch an
> Electron-ABI prebuilt), rebuild it for the host Node:
> `cd node_modules/better-sqlite3 && npx prebuild-install`

## Run

```bash
EMDASH_WEB_TOKEN=your-secret node dist/server.js
```

The startup banner prints a ready-to-open URL carrying the token.
Configuration via environment variables:

| Variable | Default | Description |
|---|---|---|
| `EMDASH_WEB_PORT` | `4200` | Listen port |
| `EMDASH_WEB_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` for LAN access) |
| `EMDASH_WEB_TOKEN` | random, printed | Access token (set it, or it changes every restart) |
| `EMDASH_WEB_DATA_DIR` | `~/.emdash-web` | User-data directory (SQLite, logs, secret key) |
| `EMDASH_WEB_ALLOW_INSECURE_REMOTE` | unset | Set to `1` to allow non-loopback binds without TLS — the token travels in plaintext, so front the server with a TLS-terminating proxy unless the network is trusted |

**Security notes**: the token grants full project, git, and terminal access
on the host machine. The server binds to loopback by default and refuses
non-loopback binds unless `EMDASH_WEB_ALLOW_INSECURE_REMOTE=1` acknowledges
the plaintext exposure — front it with a TLS-terminating proxy for anything
untrusted. Secrets at rest are encrypted with AES-256-GCM using a 0600 key
file in the data directory (the web equivalent of the desktop's OS-keychain
safeStorage). A stale token is rejected with close code 4401; the client
clears it and re-prompts instead of retrying forever.

## Smoke test

```bash
node scripts/smoke.mjs "ws://127.0.0.1:4200/ws?token=…" [/path/to/project]
```

Verifies the end-to-end path: WebSocket connect, procedure calls, live model
snapshots, and project creation.

## Differences from the desktop app (MVP boundaries)

- ✅ Core loop: projects, tasks/worktrees, git operations, diff review,
  merging, terminals (PTY), agent conversations, file editing, prompt library
- ⚠️ Desktop-only surfaces are stubbed: OS dialogs (directory picker, save
  file), clipboard writes, tray/menu, auto-update, and the Electron-webview
  in-app browser
- OAuth callback flows that target desktop callback ports are out of scope

## Layout

```
server/shim/electron.ts   Electron stand-in
server/ws-gateway.ts      WebSocket gateway (auth + domain routing)
server/index.ts           Boot orchestration (reuses desktop boot phases)
server/static.ts          Static hosting + SPA fallback
web/main.tsx              Web renderer bootstrap
web/seed-web-wire.ts      WebSocket seed (token capture/persistence)
web/shim.ts               window.electronAPI shim
build-server.mjs          esbuild (server + workers, with plugins for
                           ?asset imports, core # subpath imports, and
                           import.meta.glob inlining)
```
