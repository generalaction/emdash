# Preview-URL probe lifecycle

Type: grilling
Status: resolved

## Question

Each detected preview URL gets a TCP connect probe (500 ms timeout) every 1 second for
the lifetime of the dev server, stopping only on pty exit or 2 consecutive failures
(`packages/core/src/runtimes/terminals/node/preview/url-detector.ts:168-175`; diagnosis
§5). With several dev servers across workspaces this is a permanent per-second timer +
socket churn.

Decide the probe's lifecycle:

- What consumes liveness, and at what freshness — does anything need 1 s resolution, or
  only "went down eventually" (e.g. 10–30 s once confirmed up)?
- Backoff schedule: fast while establishing (server starting up), slow once confirmed
  healthy, fast again after a failure?
- Event-driven alternatives: probe only while a preview panel is visible / on focus, or
  react to pty output instead of wall-clock polling?

## Answer

Resolved 2026-08-06. Scope fact established first: the probe's only job is removing a
stale preview entry when the dev server dies while its terminal keeps running — PTY exit
prunes via a separate path, so probe latency only governs how fast a dead "Open preview"
entry disappears.

Decision: **adaptive cadence, confined to `startProbe`.** Probe at 1 s until the first
success (confirms a just-detected server is really up), then relax to ~15 s steady-state;
on the first failure drop back to 1 s so the second, closing failure lands within ~2 s.
Stop conditions unchanged (pty exit / 2 consecutive failures). A dead server still
vanishes near-instantly; steady-state cost drops 60 → 4 probes/minute per URL. Rejected:
visibility-gated probing (renderer→core coupling for negligible gain — same grounds as
the fetch-cadence rejection) and pty-output-driven detection (dev servers do not reliably
announce shutdown).
