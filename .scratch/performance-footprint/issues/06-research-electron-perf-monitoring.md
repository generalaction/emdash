# Research: continuous performance monitoring options for Electron apps

Type: research
Status: resolved

## Question

Survey primary sources for how an Electron app can continuously measure its own CPU,
memory, and subprocess footprint, to inform the measurement decision in
[07](07-measurement-and-regression-signal.md). Cover at least:

- Electron/Chromium APIs: `app.getAppMetrics()`, `process.getProcessMemoryInfo()`,
  `process.memoryUsage()`, `webFrame.getResourceUsage()`, `contentTracing`, V8 heap
  statistics, Node `perf_hooks` (event-loop delay/utilization, `PerformanceObserver`
  long tasks) — what each measures, per-process coverage, and sampling cost.
- How VS Code does it: its perf/telemetry machinery for startup timings, process
  explorer, extension-host resource tracking — what's worth imitating in a
  multi-worker-process Electron app.
- Practical patterns for counting child-process spawns (emdash spawns git subprocesses
  from worker processes) — instrumenting at the spawn seam vs OS-level observation.
- Renderer-side: long-task/INP observation and React render profiling in production vs
  dev-only.
- Cost/overhead of each option and whether it is safe to leave on in production
  (telemetry is optional in emdash and must remain so).

Findings go to `.scratch/performance-footprint/research/electron-perf-monitoring.md`,
each claim cited to its primary source.

## Answer

Full findings with primary-source citations:
[electron-perf-monitoring.md](../research/electron-perf-monitoring.md). Key facts:

1. **`app.getAppMetrics()` is blind to emdash's workers.** It covers only
   Chromium-managed processes (main, renderers, GPU, `utilityProcess`). Children spawned
   via plain `child_process` — emdash's ~14 workers — and their git grandchildren never
   appear. Coverage requires per-worker self-sampling or migrating workers to
   `utilityProcess.fork()` (which surfaces them with a `serviceName`).
2. **Cheap always-on primitives exist for every process type:** Electron's
   sandbox-safe `process.get*` getters; Node `process.memoryUsage.rss()` (documented
   fast variant) + `process.cpuUsage(prev)`; `v8.getHeapStatistics()` (detached-context
   counts double as leak canaries); `perf_hooks` `monitorEventLoopDelay` and
   event-loop-utilization — all explicitly designed for continuous sampling.
3. **VS Code's precedent is OS-level observation, not Electron APIs:** its process
   explorer shells out to `ps` (or `@vscode/windows-process-tree`) at 1 Hz *only while
   the explorer is open*; startup telemetry ships for ~3% of sessions; extension-host V8
   profiling attaches only after an unresponsive trigger.
4. **Spawn counting: instrument the seam, don't poll.** `exec`/`execFile`/`fork` all
   build on `spawn`, so one owned wrapper counts every own-code spawn exactly (including
   sub-second git runs that polling misses); OS-tree polling remains the only way to see
   grandchildren and their CPU/RSS.
5. **Renderer:** Long Tasks (≥50 ms) and Event Timing/INP observers are push-based and
   safe to leave on; `contentTracing` and React `<Profiler>` carry real overhead —
   dev-harness only.

Recommended split for emdash (input to ticket 07): dev-only `ps`-based process panel +
tracing; opt-in production telemetry from the cheap self-sampling set + spawn counters.
