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

**Status:** ready-for-agent

- [ ] Process panel shows the full tree including spawned grandchildren, with per-process CPU
      and memory, updating at 1 Hz
- [ ] Polling starts when the panel opens and fully stops when it closes (no background cost)
- [ ] A command captures a `contentTracing` trace to a user-visible file path
- [ ] Verbose spawn-logging mode toggles per-spawn log lines with purpose tags
- [ ] Panel exposed through the standard slice contribution + command registry patterns
