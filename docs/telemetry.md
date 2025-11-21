Telemetry

Overview
- Emdash collects anonymous usage telemetry to improve the app.
- Telemetry defaults to enabled and can be disabled via `TELEMETRY_ENABLED=false`.
- Data is sent to PostHog using explicit, allowlisted events only. There is no autocapture or session recording enabled in the app.

Environment variables (users)
- `TELEMETRY_ENABLED` (default: `true`): set to `false` to disable.

Maintainers
- Official builds inject the PostHog host and project key via CI. Local development does not send telemetry unless credentials are added explicitly for testing.
- Optional: `INSTALL_SOURCE` can label the distribution channel (e.g., `dmg`, `dev`).

Events
- `app_started` (sent automatically on app start)
  - Properties (added automatically): `app_version`, `electron_version`, `platform`, `arch`, `is_dev`, `install_source`
- `app_started` (sent automatically on app start)
  - Properties (added automatically): `app_version`, `electron_version`, `platform`, `arch`, `is_dev`, `install_source`
- `workspace_snapshot` (sent early in app lifecycle)
  - Allowed properties (coarse counts only): `project_count`, `project_count_bucket`, `workspace_count`, `workspace_count_bucket`
- `app_closed` (sent automatically on quit)
  - Same automatic properties as above
- `app_session` (sent on quit; duration only)
  - Allowed properties: `session_duration_ms`
- `feature_used`
  - Allowed properties: `feature` (string)
- `error`
  - Allowed properties: `type` (string)

Data not collected
- No code, file paths, repository names, prompts, environment variables, or PII are sent.
- Session recording is disabled; autocapture is disabled. We do not send user text input, file paths, or command contents.

Distinct ID
- A random anonymous `instanceId` is generated and stored locally at: `${appData}/telemetry.json`.
- This ID is used as `distinct_id` for telemetry events.

Opt-out
- In-app: Settings → General → Privacy & Telemetry (toggle off), or
- Env var: set `TELEMETRY_ENABLED=false` before launching the app to disable telemetry entirely.

Renderer events (maintainers)
- The renderer may request sending `feature_used` or `error` events via a constrained IPC channel handled in the main process.
- Only allowlisted properties are forwarded; everything else is dropped by the sanitizer in the main process.
- End-users do not need to take any action; telemetry remains optional and can be disabled as described above.

Agent/provider usage (future, privacy-safe)
- If we add agent usage telemetry, it will be limited to coarse metadata: provider id (e.g., `codex`, `claude`), action (`agent_run_start` / `agent_run_end`), outcome (`ok`/`error`), and duration/counts. No prompts, messages, file paths, or workspace identifiers would be sent.
- This would reuse the same anonymous `distinct_id`, honor the telemetry toggle, and remain off in builds without PostHog keys.
