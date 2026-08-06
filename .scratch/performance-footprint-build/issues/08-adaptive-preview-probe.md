# 08 — Adaptive preview probe

**What to build:** the preview-URL port probe stops burning a fixed fast cadence forever.
It probes fast (1 s) until the port first responds, relaxes to a slow steady-state cadence
(~15 s) while the server stays up, and snaps back to the fast cadence the moment a probe
fails — so a dead server's preview affordance still disappears promptly and a restarting
server is re-detected quickly.
Spec: [preview probe decision](../../performance-footprint/issues/05-preview-probe-lifecycle.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** ready-for-agent

- [ ] Cadence transitions (fast → steady on first success, steady → fast on failure) covered
      by fake-timer unit tests against the injectable probe seam
- [ ] A freshly started dev server is detected within ~1 s; a killed server's preview state
      clears within one steady-state interval plus the fast re-check
- [ ] Steady-state probe rate is ~15× lower than before, visible in the ticket 02 spawn/log
      counters
