# Performance measurement and the regression signal

Type: grilling
Status: resolved
Blocked by: 06

## Question

The diagnosis was ad hoc (`ps`, `sample`, DevTools). Decide the durable measurement story
so the fixes from this map stay fixed and the next regression is caught by a signal, not a
user's Activity Monitor screenshot:

- What does emdash measure continuously — per-process CPU/RSS via `app.getAppMetrics()`,
  event-loop delay in workers, git-spawn counts per minute, renderer long tasks? Which
  metrics specifically guard findings 1–5 in the [diagnosis](../assets/diagnosis.md)?
- Where does it live: a dev-only harness (metrics log during dev sessions), an opt-in
  in-app surface (the machines UI already samples host resources), and/or telemetry
  (which must remain optional)?
- What is the regression signal in practice — a threshold that alerts during dev, a
  periodic summary in logs, a CI perf smoke? Who looks at it and when?
- What is deliberately *not* measured (overhead budget for the measurement itself)?

Informed by the research in
[06](06-research-electron-perf-monitoring.md) (findings at
`../research/electron-perf-monitoring.md`).

## Answer

Resolved 2026-08-06, building on the research ticket's findings.

Two decisions:

1. **Worker visibility comes from per-worker self-sampling; the `utilityProcess`
   migration is out of scope.** Each worker reports `process.memoryUsage.rss()`,
   `process.cpuUsage(prev)`, event-loop delay/utilization, and `v8.getHeapStatistics()`
   (detached-context count as a leak canary) over existing IPC — all documented
   continuous-sampling-safe APIs. Migrating workers to `utilityProcess.fork()` (which
   would unify them under `app.getAppMetrics()`) is explicitly ruled out of this effort:
   it changes process spawning/supervision (AGENTS.md high-risk territory) and is not
   required for the measurement goal. The two-track shape from the research is adopted:
   - **Dev harness:** VS Code-style OS process-tree panel (`ps` at ~1 Hz, only while
     open, covering git grandchildren), a `contentTracing` capture command, verbose
     spawn logging.
   - **Always-on (behind the existing telemetry opt-in, VS Code-style session
     sampling):** main-process `app.getAppMetrics()` on a slow interval +
     event-loop-delay monitoring; worker self-sampling as above; spawn-seam counters in
     main and workers (the only reliable way to count sub-second git spawns); renderer
     `longtask` + event-timing/INP observers. No React profiling build in production;
     V8 CPU profiles only trigger-attached, with consent.
2. **The regression signal of record is sampled production telemetry on named
   counters**, with the same counters printed locally by the dev harness so
   implementers verify before/after during the build phase. Guarding metrics per fix:
   - git spawn-rate per minute → guards the scan-policy (02) and fetch fan-out (03) fixes;
   - per-process RSS trend + main event-loop delay → guards the terminal-output
     buffering fix (01);
   - live terminal count × retained buffer bytes → guards the scrollback/renderer
     release fix (04);
   - probe count per minute → trivially guards (05).
   **CI perf gates are rejected for now** — timing-based gates on shared runners are
   flaky and high-maintenance, and this map's fixes are rate/bound properties that field
   counters capture better; revisit only if field telemetry proves insufficient. This
   settles the map's last fog item.
