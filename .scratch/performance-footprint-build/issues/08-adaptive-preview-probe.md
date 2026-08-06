# 08 — Adaptive preview probe

**What to build:** the preview-URL port probe stops burning a fixed fast cadence forever.
It probes fast (1 s) until the port first responds, relaxes to a slow steady-state cadence
(~15 s) while the server stays up, and snaps back to the fast cadence the moment a probe
fails — so a dead server's preview affordance still disappears promptly and a restarting
server is re-detected quickly.
Spec: [preview probe decision](../../performance-footprint/issues/05-preview-probe-lifecycle.md).

**Blocked by:** 02 — Before/after instruments.

**Status:** done

- [x] Cadence transitions (fast → steady on first success, steady → fast on failure) covered
      by fake-timer unit tests against the injectable probe seam
      (`url-detector.test.ts` — "adaptive probe cadence" suite)
- [x] A freshly started dev server is detected within ~1 s; a killed server's preview state
      clears within one steady-state interval plus the fast re-check
      — *Covered by the same fake-timer tests: the first probe fires immediately on URL
      detection and repeats at 1 s until the first success; a post-steady failure schedules
      the closing re-check 1 s later, so worst-case clear time is one steady interval + 1 s.*
- [x] Steady-state probe rate is ~15× lower than before, visible in the ticket 02 spawn/log
      counters
      — *Structural: steady cadence is 15 s vs. the previous fixed 1 s (60 → 4 probes/min
      per URL). The default `isPortOpen` probe now records under the `probe` purpose tag in
      the ticket-02 spawn counters so the rate is observable in the dev instruments; a live
      before/after counter capture needs a GUI run with a dev server and was not performed.*

## Implementation notes

- `startProbe` in `packages/core/src/runtimes/terminals/node/preview/url-detector.ts` now
  picks the next delay per tick: `PROBE_STEADY_INTERVAL_MS` (15 s) after a successful probe,
  `PROBE_FAST_INTERVAL_MS` (1 s) after a failure or before the first success. Stop conditions
  are unchanged (pty exit / 2 consecutive failures), and the change is confined to
  `startProbe` per the decision.
- Both cadence constants are exported for the tests; the default `isPortOpen` probe records
  a `probe`-tagged event via `@emdash/shared/perf` on each attempt (map increment, always-on
  per the spawn-metrics design).
