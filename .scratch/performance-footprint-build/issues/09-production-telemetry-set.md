# 09 — Optional production telemetry set

**What to build:** for users who have telemetry enabled, a sampled subset of sessions reports
the performance vitals that make regressions visible in the field: per-worker self-sampling
(RSS, CPU, event-loop delay/ELU, heap statistics with a detached-context canary) reported over
the existing worker IPC channel; main-process app metrics and event-loop delay; and renderer
long-task and interaction (INP) observers. Session-level sampling keeps volume low, everything
rides the existing telemetry opt-in, and a user with telemetry disabled pays zero cost — no
timers, no observers. This becomes the regression signal of record for the fixes in this
effort.
Spec: [measurement decision, track 2](../../performance-footprint/issues/07-measurement-and-regression-signal.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** ready-for-agent

- [ ] Workers self-sample and report through the existing IPC report boundary, covered by
      tests at that boundary
- [ ] Main process reports app metrics and event-loop delay on the sampled cadence
- [ ] Renderer registers long-task and INP performance observers only in sampled sessions
- [ ] Telemetry-disabled sessions create no timers or observers (asserted by test)
- [ ] Payloads pass the existing redaction rules; no paths or command lines leak
