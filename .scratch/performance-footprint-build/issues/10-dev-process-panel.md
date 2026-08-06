# 10 — Dev process panel and tracing capture

**What to build:** a developer diagnosing a hot or bloated emdash can open an in-app process
panel — VS Code-style — showing the live process tree (main, renderer, workers, and spawned
grandchildren like git) with CPU and memory per process, refreshed at 1 Hz via `ps` polling
that runs only while the panel is open. Alongside it: a command that captures a
`contentTracing` trace to a file for offline analysis, and a verbose spawn-logging mode that
logs every child-process spawn with its purpose tag for burst forensics.
Specs: [measurement decision](../../performance-footprint/issues/07-measurement-and-regression-signal.md),
[monitoring research](../../performance-footprint/issues/06-research-electron-perf-monitoring.md).

**Blocked by:** None — can start immediately (scheduled last in the plan, but nothing gates it).

**Status:** done

- [x] Process panel shows the full tree including spawned grandchildren, with per-process CPU
      and memory, updating at 1 Hz
- [x] Polling starts when the panel opens and fully stops when it closes (no background cost)
- [x] A command captures a `contentTracing` trace to a user-visible file path
- [x] Verbose spawn-logging mode toggles per-spawn log lines with purpose tags
- [x] Panel exposed through the standard slice contribution + command registry patterns

**Implementation notes:**

- New `dev-perf` slice: Wire contract (`processSnapshot`, `captureTrace`,
  `setVerboseSpawnLogging`/`getVerboseSpawnLogging`), node controller, and browser UI.
- Snapshots run one `ps -A -o pid=,ppid=,pcpu=,rss=,comm=` per poll on the main side and
  flatten the tree rooted at the main pid depth-first, so spawned grandchildren (git etc.)
  appear indented under their worker. Unsupported on Windows (`supported: false`).
- Polling is strictly panel-driven: the renderer's `createProcessPoller` fetches once on
  open, re-arms 1 s after each response, and `stop()` on unmount cancels the timer and
  drops in-flight results; the main process runs `ps` only when asked.
- `devPerf.captureTrace` (palette) and the panel button record a 10 s `contentTracing`
  trace to `<userData>/traces/emdash-trace-<timestamp>.json` and surface the path.
- Verbose spawn logging flips the ticket-02 spawn observer to a log line
  (`perf.spawn` with purpose + command) in the main process and broadcasts a
  `spawn-log` toggle over the worker vitals channel to every live and future worker.
- Exposure follows the standard patterns: modal def via slice `contributions/browser.ts`
  aggregated in `browser-contributions.ts`; commands via `contributions/commands.ts` in
  `COMMAND_CATALOG`, palette items in `PALETTE_CATALOG`, window-scope handlers in the
  workbench `WindowScope`. Core/host boundary respected by injecting the wire client from
  the renderer bootstrap (`configureDevPerfClient`).
