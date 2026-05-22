# RFC: Hookable Lifecycle System for Automations

## Goal

Use `HookCore` as a shared lifecycle bus so automations can expose pre-run and post-run extension points, including future user scripts, without coupling scripts to scheduler internals.

## Proposed Shape

- Keep domain-owned typed hook schemas, e.g. `AutomationHooks` in `src/main/core/automations/automation-events.ts`.
- Emit lifecycle events from the owning runtime/scheduler at stable boundaries:
  - `automation:run:start` after a queued run is claimed and marked running.
  - `automation:run:skipped` after a queued run is finalized as skipped.
  - `automation:run:finish` after a run is finalized as success.
  - `automation:run:failed` after a run is finalized as failed.
- Use the persisted `AutomationRun` as the minimum payload. Add contextual payload wrappers later only when needed.

## User Script Registration

A future `AutomationLifecycleScriptService` would initialize on app startup and register handlers with `automationEvents.on(...)`:

```ts
automationEvents.on('automation:run:start', (run) =>
  userScriptRunner.run('automation.pre-run', { run })
);

automationEvents.on('automation:run:finish', (run) =>
  userScriptRunner.run('automation.post-run', { run, outcome: 'success' })
);
```

The service owns script discovery, enablement, sandboxing, timeouts, and logging. `AutomationScheduler` and `runQueuedAutomation` only emit typed lifecycle events.

## Execution Semantics

- Default lifecycle hooks are fire-and-forget via `callHookBackground` so user scripts cannot block scheduler throughput.
- If blocking pre-run hooks become necessary, add a separate awaited hook such as `automation:run:before-claim` or switch only that boundary to `callHook` with explicit timeout handling.
- Hook errors are logged by `HookCore` and do not mutate run state unless a future RFC defines cancellable hooks.

## Open Questions

- Script location and project scoping: global app scripts vs per-project `.emdash` scripts.
- Security model: local trust boundary, environment variable exposure, and filesystem access.
- Retry policy for failed post-run hooks.
- Whether pre-run scripts should ever be able to skip/cancel a run.
