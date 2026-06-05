# Headless Emdash Agent Runner on the Home Server — Design

**Status:** Approved for iteration 1 (prove-it-works)
**Date:** 2026-06-05

## Goal

Run Emdash automations *on the home server*, headless and 24/7-capable, so a
webhook can trigger an agent (`claude`) that makes a commit without the user's
Mac being involved. Iteration 1 success = **one webhook → one commit on the
server**. Manual launch is acceptable; no systemd/auto-start yet.

## Background

The current architecture splits responsibilities:

- `emdash-server` (Fastify + SQLite, pm2, port 8080) is **only an event
  mailbox**. `POST /webhook/:token` stores a `pending` row. It runs no agent.
- The **Emdash desktop app** (Electron, on the Mac) polls
  `GET /api/events/pending` every 5s, matches the token to an automation,
  enqueues a run, and spawns `claude` via `node-pty` locally. All agent
  execution happens wherever the desktop app runs.

So today automations only run while the Mac app is open and polling. The
tunnel makes the server reachable 24/7, but events queue until the Mac wakes.

This design adds a **second, headless instance of the full Emdash desktop app**
on the server, running under a virtual display (Xvfb). The server becomes the
sole automation runner.

## Chosen approach

**Approach 1: packaged `.deb`, built on the server.** Building Linux x64
artifacts from the Mac would require cross-compiling native modules
(`node-pty`, `better-sqlite3`) — the exact ABI class of bug that caused the
`Napi::Error` crash fixed earlier today. Building *on* the server (x86_64
Linux) compiles native modules for the correct target natively. The packaged
app is then installed and launched under `xvfb-run`.

Rejected:
- **Approach 2 (run from `electron-vite` dev source under Xvfb):** fastest to
  iterate but not production-shaped; user chose the packaged path.
- **Approach 3 (Docker w/ Xvfb):** Electron-in-Docker with native modules +
  virtual display is finicky; overkill for prove-it-works.

## Architecture / topology

```
External webhook (GitHub/Linear/curl)
        │ POST /webhook/:token
        ▼
┌──────────────────────────────┐
│  emdash-server (pm2)          │  UNCHANGED — event mailbox/queue
│  Fastify + SQLite @ :8080     │
└──────────────────────────────┘
        │ GET /api/events/pending  (poll every 5s)
        │ POST /api/events/:id/ack
        ▼
┌──────────────────────────────┐
│  Headless Emdash (.deb)       │  NEW — runs under Xvfb
│  xvfb-run emdash              │  • polls its own queue
│  ~/.config/emdash/emdash4.db  │  • spawns claude via node-pty
└──────────────────────────────┘  • works in /opt/projects/doc-engine
        │ git branch/commit/push
        ▼
   Remote (GitHub)

Mac: desktop app for INTERACTIVE work only.
  ⚠️ emdash-server connection DISABLED on Mac so it does NOT poll.
```

Both server processes (`emdash-server` via pm2, headless app via Xvfb) talk
over `localhost:8080`.

### Why the Mac must stop polling

`GET /api/events/pending` returns all pending events to any caller (no
server-side claim). The desktop watcher enqueues + runs the automation
*before* acking. So if both the Mac and the server poll, both run the same
event and only then race on the conditional `ack`. Duplicate runs result.
Disabling the Mac's `emdash-server` connection makes the server the sole
poller. This is the only behavioral change outside the server.

## Components (one-time setup, all on the server)

Server facts: x86_64, 8GB+ RAM, Linux, SSH user `gp`, host
`home-server.local`, already runs `emdash-server` via pm2, `better-sqlite3`
already compiled there. Linux userData path is `~/.config/emdash/`.

1. **System packages** — `xvfb` + Electron/Chromium runtime libs
   (`libgtk-3-0`, `libnss3`, `libasound2`, `libgbm1`, `libxshmfence1`,
   `libdrm2`, etc.). One `apt-get install`.

2. **App built on the server** — sync repo to `/opt/emdash-app`,
   `npm install` (postinstall rebuilds `node-pty` + `better-sqlite3` for Linux
   x64 with the pinned Electron version), then `pnpm package:linux` → `.deb`.
   Install it. `electron-builder` already `asarUnpack`s `node-pty/**` and
   `better-sqlite3/**`, so node-pty's `spawn-helper` lands in
   `app.asar.unpacked/` where the loader expects it.

3. **Claude credentials** — copy the Mac's `~/.claude/` (and `~/.claude.json`)
   to `/home/gp/` so the subscription login carries over. The hardened
   `ClaudeTrustService` writes `bypassPermissionsModeAccepted`, so the headless
   app won't hang on the consent prompt.

4. **Project checkout** — `git clone` the target repo to
   `/opt/projects/doc-engine`, configure push remote + credentials, register it
   as an Emdash project at that path. Automation uses `repository-instance`
   (project root), so no worktrees.

5. **Mac config toggle** — disable the `emdash-server` connection on the Mac.

**Launch (iteration 1, manual):** `xvfb-run -a <installed emdash binary>`.
Scheduler + webhook-watcher start; it polls `localhost:8080`.

## Data flow of one run

1. `curl -X POST http://server:8080/webhook/<token>` → `pending` row, 202.
2. Headless app polls, matches token → automation.
3. Enqueue run → `drainQueue()` claims → `executeTaskCreate`: create task +
   conversation, provision `repository-instance` workspace at
   `/opt/projects/doc-engine`, `startSession` spawns `claude` via node-pty
   under Xvfb.
4. `claude` runs the prompt (`--dangerously-skip-permissions`), edits, commits,
   pushes.
5. `POST /api/events/:id/ack` → event `processed`.

## Error handling (known failure modes)

| Failure | Mitigation |
|---|---|
| node-pty ABI crash (`Napi::Error`) | Build native modules on the server (correct target) + pinned-version postinstall |
| `--dangerously-skip-permissions` consent hang | `bypassPermissionsModeAccepted` + copied credentials |
| Duplicate runs | Mac poll disabled; server is sole poller |
| `claude` not authenticated | Run fails; visible in `~/.config/emdash/logs/`. Re-copy/refresh creds |
| git push rejected (no remote auth) | Agent output shows it; configure push creds on the checkout |
| Xvfb missing / no display | `xvfb-run -a` always provides a display |

## Verification

- **Boot check:** `xvfb-run` the app; logs show `AutomationScheduler` and
  `WebhookWatcher: started polling`.
- **End-to-end:** fire the curl webhook; tail `~/.config/emdash/logs/emdash.log`
  for the run starting + `claude` spawning; `git log` in
  `/opt/projects/doc-engine` shows a new commit. **That commit is the success
  criterion.**
- **Queue check:** `GET /api/events` shows the event flipped
  `pending → processed`.

## Out of scope (deferred to later iterations)

- systemd / auto-start on boot / crash-restart
- A reusable from-scratch setup script (like `deploy.sh`)
- Streaming agent output back to the Mac's UI
- Multiple repos, concurrency limits
- Securing/locking the event queue server-side (claim semantics)

## Constraint on execution

The server is not reachable from the development environment where this work is
authored (`home-server.local` does not resolve off-network). Therefore the
deliverable is a **setup script + exact commands the user runs on the server**,
not steps executed remotely. If direct SSH access becomes available, the same
commands can be run on the user's behalf.
