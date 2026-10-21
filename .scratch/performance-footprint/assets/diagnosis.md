# Performance and memory diagnosis — 2026-08-06

Evidence base for the `performance-footprint` map. Every ticket cites this file; zoom here
before re-deriving facts. Produced by a live-process investigation plus two codebase scans
(main process + packages/core, and renderer + shared UI packages).

## Machine-level findings (resolved, not app bugs)

- **1.76 TB "Virtual Memory Size" is normal.** macOS reports reserved address space; V8's
  pointer-compression cage and Chromium's allocator reserve terabytes by design. Every
  Electron process on the machine shows ~1.8 TB. The metric that matters is private/real
  memory growth over time. Emdash at 422 MB real / 360 MB private is unremarkable.
- **The CPU burn was not emdash.** Three orphaned `nx storybook @emdash/ui` processes
  (launched via global Homebrew nx 21.4.0 against a repo on nx 23.0.0) each pinned a full
  core for 10–22 days — a single thread spinning on a dead `read()` inside Nx's native
  module after the parent terminal died. Killed with SIGKILL on 2026-08-06 (they ignored
  SIGTERM). Guidance: launch nx via the repo (`pnpm exec nx ...`), never the global CLI.
- Baseline note: the app deliberately spawns ~14 persistent Node worker child processes
  (`apps/emdash-desktop/src/main/gateway/desktop-workers.ts`), so a few-hundred-MB
  baseline across the process tree is by design.

## High-impact code findings (verified in source)

### 1. ACP agent-terminal output is buffered unboundedly, twice (memory + CPU, HIGH)

Main side — `packages/core/src/runtimes/acp/node/runtime/terminal-live-registry.ts:43-54`:
`onTerminalOutput` rebuilds the full accumulated string per chunk
(`output: \`${record.state.output}${chunk}\``) with **no cap**, and republishes
conversation state per chunk. The adjacent `record.log` (`LiveLogSource`,
`packages/wire/src/live/log/source.ts`) is already capped at 1 MB and documented as the
authoritative stream; `state.output` duplicates it unbounded. Upstream,
`ManagedAcpTerminal` ring-buffers at 4 MB (`acp/node/agent-ports/managed-terminal.ts`).

Renderer side — `apps/emdash-desktop/src/core/features/conversations/browser/acp/acp-terminal-output-binding.ts:49-51`:
on every append, `setTerminalOutput(terminalId, binding.text())` pushes the **full**
accumulated text into chat state; `packages/wire/src/live/mobx/mobx-log-store.ts` grows an
observable string by concatenation per chunk. O(n²) over a stream, unbounded growth for
agent-spawned dev servers/watchers.

### 2. Watcher-triggered full git scans at 250 ms debounce (CPU, HIGH)

`packages/core/src/runtimes/workspace-registry/node/scan/observe-git.ts:82-114` — one
full workspace scan runs ~5–6 git subprocesses (`rev-parse`, `status --porcelain
--untracked-files=all`, `rev-parse @{u}`, `rev-list --count`, `diff --numstat HEAD`)
**plus** reads every untracked file to count lines (`countUntrackedLines`, lines 210–227;
up to 5,000 files × 5 MB each).
`scan/scheduler.ts:115-122, 191-194` — any file event triggers a full scan, debounced at
**250 ms for active workspaces** (2 s otherwise). An agent writing files continuously ≈
6 git spawns + untracked reads every 250 ms, per active workspace — and parallel active
workspaces are the product's premise.

### 3. Fetch-loop ref fan-out (CPU, MEDIUM/HIGH)

`apps/emdash-desktop/src/main/core/git/repository/fetch-service.ts:60` — `git fetch` on a
2-minute `setInterval` per open project (properly cleared). Each fetch writes
`FETCH_HEAD`/refs; `scan/scheduler.ts:165-173` turns a ref event into a refs scan (2 git
subprocesses) for **every worktree of that repo**. Steady-state: every 2 min, 1 fetch +
2×N subprocesses across N worktrees, per project.

### 4. Off-screen xterm terminals retained forever with 100k scrollback (renderer memory, HIGH)

`apps/emdash-desktop/src/core/features/terminals/api/browser/pty/pty.ts:15` —
`SCROLLBACK_LINES = 100_000`. `terminals/browser/pty/use-pty.ts:71-76` — on unmount the
terminal is reparented to an off-screen host, never disposed, "so scrollback is preserved
across tab switches". Memory scales with every terminal ever opened in the session.
(Also `AgentSignInModal.tsx:170` hardcodes a second 100k-scrollback terminal.)

### 5. Preview-URL probe (CPU, MEDIUM)

`packages/core/src/runtimes/terminals/node/preview/url-detector.ts:168-175` — a TCP
connect probe (500 ms timeout) every **1 s per detected preview URL**, for the lifetime of
the dev server. Stops only on pty exit or 2 consecutive failures.

## Low-severity items (quick wins, no decision needed)

- `CLISpinner` recreates its 80 ms interval every tick (renderer).
- TUI idle sweep spawns a `tmux` subprocess every 60 s even with zero sessions
  (`packages/core/src/runtimes/tui-agents/node/runtime/runtime.ts:140-145`).
- ACP raw event log capped by entry count (50k), not bytes
  (`acp/node/session/raw-log.ts:58,77-80`).
- `AGENTS.md` still points at `src/main/core/resource-monitor/` and `src/main/core/pty/`;
  both moved under `packages/core/src/runtimes/` and `packages/core/src/services/pty/`.

## Polling inventory (main + packages/core)

| Location | Interval | Work per tick |
|---|---|---|
| `main/core/git/repository/fetch-service.ts:60` | 2 min/project | `git fetch` subprocess |
| `workspace-registry/node/scan/scheduler.ts:85` | 5 min | Poll floor: full git scan per stale record |
| `core/services/pull-requests/node/pull-request-service.ts:82` | 5 min | GitHub sync + SQLite writes per registered repo |
| `workspace-host/node/session/session-gc.ts:21` | 60 s | Session GC, `fs.stat` per cwd |
| `tui-agents/node/runtime/runtime.ts:140-145` | 60 s | Idle sweep incl. unconditional tmux spawn |
| `terminals/node/runtime/runtime.ts:194-197` | 60 s | Idle sweep, in-memory |
| `acp/node/runtime/session-manager.ts:134-136` | 60 s | Idle sweep, in-memory |
| `terminals/node/preview/url-detector.ts:168-175` | 1 s/URL | TCP connect probe |
| `main/lib/telemetry.ts:383` | 60 s | SQLite heartbeat write |
| `main/host/updates/update-service.ts:183` | 1 h | Network update check |

## Already healthy (do not spend map time here)

- PTY/terminal output byte-capped at 1 MB per session (`packages/wire/src/live/log/source.ts:5`).
- Chat transcript virtualized (Fenwick virtualizer) with incremental markdown parsing.
- Monaco models ref-counted with TTL eviction.
- Event subscriptions consistently lease/scope-managed; no listener leaks found.
- Resource monitor is pull-based (no timers, no subprocesses), sampled at 5 s only while
  the machines UI is visible (`packages/core/src/runtimes/resource-usage/`).
- fs watching is `@parcel/watcher` native recursive, deduplicated, released on dispose;
  one watch per worktree root + one per repo `.git` dir.

## Measurement techniques used (reusable)

- Per-process: `ps -Ao pid,pcpu,rss,vsz,comm`, `ps -M <pid>` (per-thread), `sample <pid> 5`
  (native stacks; how the nx zombies were caught).
- Main-process JS: `--inspect=9229` + Chrome DevTools (CPU profile, three-heap-snapshot leak
  technique). Renderer: DevTools Performance panel during long streams.
- In-app: `app.getAppMetrics()` for per-process CPU/memory from inside Electron.
- Subprocess churn: count spawns at the git-worker spawn site, watch spawns/minute.
