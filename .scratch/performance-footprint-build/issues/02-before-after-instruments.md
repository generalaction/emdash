# 02 — Before/after instruments

**What to build:** a developer running the app in dev mode can see, without attaching a
profiler, (a) how many child processes the app spawns per minute broken down by purpose (git
scan, fetch, tmux, probe, other) and (b) the RSS of each app process on a slow cadence. Both
appear in dev logs behind the existing debug-logging switch. These are the numbers every fix
ticket in this effort cites as its before/after evidence, so this lands before any fix.
Spec: [measurement decision, track 1](../../performance-footprint/issues/07-measurement-and-regression-signal.md).

**Blocked by:** None — can start immediately.

**Status:** ready-for-agent

- [ ] All child-process spawns flow through a counted seam; counts are tagged by purpose and
      logged per minute in dev
- [ ] Per-process RSS (main, renderer, workers) logged on a slow cadence in dev
- [ ] Zero overhead when debug logging is off (no timers, no sampling)
- [ ] Counter seam has unit tests; a dev-mode smoke run shows both log lines
