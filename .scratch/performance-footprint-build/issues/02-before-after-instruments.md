# 02 — Before/after instruments

**What to build:** a developer running the app in dev mode can see, without attaching a
profiler, (a) how many child processes the app spawns per minute broken down by purpose (git
scan, fetch, tmux, probe, other) and (b) the RSS of each app process on a slow cadence. Both
appear in dev logs behind the existing debug-logging switch. These are the numbers every fix
ticket in this effort cites as its before/after evidence, so this lands before any fix.
Spec: [measurement decision, track 1](../../performance-footprint/issues/07-measurement-and-regression-signal.md).

**Blocked by:** None — can start immediately.

**Status:** done

- [x] All child-process spawns flow through a counted seam; counts are tagged by purpose and
      logged per minute in dev
- [x] Per-process RSS (main, renderer, workers) logged on a slow cadence in dev
- [x] Zero overhead when debug logging is off (no timers, no sampling)
- [x] Counter seam has unit tests; a dev-mode smoke run shows both log lines

Implementation notes: counters live in `@emdash/shared/perf` (`recordSpawn` /
`classifySpawnPurpose` / `snapshotSpawnCounts`); the per-process reporter is
`startDevPerfInstruments`, gated on `logger.level === 'debug'`
(`EMDASH_LOG_LEVEL=debug` or the main process `--debug-logs` flag). Instrumented
seams: BoundExec (git worker), NodeExecutionContext (tmux etc.), node-pty spawner,
ACP child-process host (agent + agent terminals), wire worker fork, shell-env
capture, process-tree `ps`, and the main-process `runLocalCommand`. Workers start
the reporter in `initWorkerProcessLogging`; the main process adds
`app.getAppMetrics()` (renderer/GPU RSS) via `startMainDevPerfInstruments`. The
smoke check was run against the built module (pino output verified); an attached
full-GUI dev session was not part of this environment.
