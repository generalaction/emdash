Telemetry

Overview
- Emdash collects anonymous usage telemetry to improve the app.
- Telemetry defaults to enabled and can be disabled via `TELEMETRY_ENABLED=false`.
- Data is sent to PostHog using explicit, allowlisted events only. Autocapture is disabled.

Environment variables (users)
- `TELEMETRY_ENABLED` (default: `true`): set to `false` to disable.
- `POSTHOG_PROJECT_API_KEY`, `POSTHOG_HOST` (optional): only needed to test telemetry locally; otherwise official builds inject these via CI.

Maintainers
- Official builds inject the PostHog host and project key via CI (into `dist/main/appConfig.json`). Local development does not send telemetry unless credentials are added explicitly for testing (e.g., `.env` or shell env vars).
- Optional: `INSTALL_SOURCE` can label the distribution channel (e.g., `dmg`, `dev`).

Events (and allowed properties)
- `app_started` (auto on app start)
  - Automatic props: `app_version`, `electron_version`, `platform`, `arch`, `is_dev`, `install_source`
- `workspace_snapshot` (early in lifecycle)
  - Allowed props: `project_count`, `project_count_bucket`, `workspace_count`, `workspace_count_bucket` (coarse counts only)
- `app_closed` (auto on quit)
  - Same automatic props as `app_started`
- `app_session` (on quit; duration only)
  - Allowed props: `session_duration_ms`
- `feature_used`
  - Allowed props: `feature` (string)
- `error`
  - Allowed props: `type` (string)
- `agent_run_start`
  - Allowed props: `provider` (CLI provider id; see `src/shared/providers/registry.ts`)
- `agent_run_finish`
  - Allowed props: `provider` (CLI provider id), `outcome` (`ok` | `error`), `duration_ms` (clamped; no content)

Data not collected
- No code, file paths, repository names, prompts, environment variables, or PII are sent.
- No geo/referrer enrichment is added; we do not attach IP-derived location data.

Distinct ID
- A random anonymous `instanceId` is generated and stored locally at `${appData}/telemetry.json`.
- This ID is used as `distinct_id` for telemetry events.

Opt-out
- In-app: Settings → General → Privacy & Telemetry (toggle off), or
- Env var: set `TELEMETRY_ENABLED=false` before launching the app to disable telemetry entirely.

Renderer events (maintainers)
- The renderer may request sending `feature_used` or `error` events via a constrained IPC channel handled in the main process.
- Only allowlisted properties are forwarded; everything else is dropped by the sanitizer in the main process.
- End-users do not need to take any action; telemetry remains optional and can be disabled as described above.


Agent/provider usage
- Coarse metadata only: provider id, start/end markers, outcome, and duration. No prompts, messages, file paths, workspace IDs, or other content are sent.
- Events now originate from PTY lifecycle for CLI providers (`{provider}-main-{workspace}` terminals). No stream content is inspected.
- Uses the same anonymous `distinct_id`, honors the telemetry toggle, and remains off in builds without PostHog keys.
