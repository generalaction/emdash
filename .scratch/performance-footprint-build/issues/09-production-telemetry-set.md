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

**Status:** done

- [x] Workers self-sample and report through the existing IPC report boundary, covered by
      tests at that boundary (`packages/wire/src/worker/vitals.test.ts`: collecting-spawner
      forwarding, start-message activation incl. restarts, worker-side inertness until start)
- [x] Main process reports app metrics and event-loop delay on the sampled cadence
      (`boot/phases/perf-vitals.ts`: self-sampler + `app.getAppMetrics()` summary every 5 min)
- [x] Renderer registers long-task and INP performance observers only in sampled sessions
      (`src/renderer/utils/perf-vitals.ts` + test)
- [x] Telemetry-disabled sessions create no timers or observers (asserted by test)
      — *renderer: "registers no observers and no timers when the session is not sampled";
      workers: "creates no sampling instruments until the start message arrives"; main:
      `startPerfVitalsTelemetry` returns before creating anything when
      `isPerfSampledSession()` is false, which is always the case when telemetry is disabled.*
- [x] Payloads pass the existing redaction rules; no paths or command lines leak
      — *vitals are numbers-only by construction (`PERF_VITALS_ALLOWED_KEYS`, asserted in
      `packages/shared/src/perf/node/vitals.test.ts`); the only string is `process_name`
      (`main` / `worker_<id>` from the fixed worker-name env). All new keys were added to the
      default-deny property allowlist in `sanitizeEventAndProps`, so anything outside the
      fixed key set is dropped at the capture boundary.*

## Implementation notes

- **Sampling roll:** `DesktopTelemetryService.initialize` decides once per session:
  `perfSampled = isEnabled() && Math.random() < 0.05`. Exposed as
  `isPerfSampledSession()` and as `perf_sampled` on `TelemetryStatus` (contract + zod
  updated) so the renderer can ask over the existing RPC.
- **Shared sampler:** `@emdash/shared/perf/node` (new subpath export) provides
  `createVitalsSampler` / `startVitalsReporting` — RSS, CPU-percent since last sample,
  event-loop delay p95/max (`monitorEventLoopDelay`), ELU delta, V8 heap stats with the
  detached-context canary, and the ticket-02 spawn counters flattened as `spawns_<purpose>`.
- **Worker boundary:** `createVitalsCollectingSpawner` decorates the worker process spawner;
  the host sends a `start` message (only in sampled sessions) and workers reply with
  numbers-only `report` messages over the existing fork IPC channel. Worker side is installed
  by `initWorkerProcessLogging` (`installWorkerVitals`) and is inert — one message listener,
  zero timers — until the start message arrives. Restarted workers are re-activated
  automatically.
- **Activation:** `bootBackground` → `startPerfVitalsTelemetry(runtimes)` (runs after the
  services phase, so the sampling decision exists before activation). Cadence: 5 minutes.
- **Events:** `perf_vitals` (main + workers, `process_name` distinguishes) and
  `perf_renderer_vitals` (long-task count/total, INP-style worst interaction, per interval),
  both typed in `TelemetryEventProperties`.
- Note on counter interplay: the spawn counters are drained by whichever reporter samples
  them (dev instruments at debug level, or the vitals sampler). Both run only in disjoint
  configurations in practice (dev-debug vs. sampled production sessions); if both are ever
  on, counts split between the two streams.
