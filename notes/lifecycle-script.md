# Lifecycle Scripts Rework Plan

## Goal

Support lifecycle phases in Emdash using main-process orchestration (not terminal injection):

- `setup`: one-shot initialization per task/worktree
- `run`: long-lived managed process per task/worktree
- `teardown`: one-shot cleanup on archive/delete (and optional manual stop)

Primary objective: ship quickly with clear behavior, minimal risk, and room to extend later.

## Current State (Baseline)

- `.emdash.json` supports only `scripts.setup` in `src/main/services/LifecycleScriptsService.ts`.
- Setup is currently injected into terminal input from renderer (`TaskTerminalPanel`).
- A run-like process manager exists in `hostPreviewService` but is not wired to `.emdash.json` lifecycle config.
- No config-driven teardown phase exists.

## Scope for MVP

- Add `scripts.run` and `scripts.teardown` to config parsing.
- Introduce a dedicated main-process lifecycle service for execution/state/events.
- Replace setup terminal injection with lifecycle IPC call.
- Integrate run lifecycle with preview startup path (config first, autodetect fallback).
- Integrate teardown lifecycle with task archive/delete.
- Update docs for new script semantics.

Out of scope for MVP:

- DB persistence of lifecycle runtime state
- rich per-phase options (`timeoutMs`, retry policy, blocking policy)
- complex dependency graph between phases

## Guardrails

- One run process max per task/worktree.
- Lifecycle commands execute in task worktree `cwd`.
- Execution is idempotent where practical:
  - setup: no duplicate concurrent run for same task
  - run start: no-op if already active
  - run stop: safe if no process
  - teardown: best-effort, safe to retry
- Failures are surfaced via events/logs; destructive flows continue in MVP unless explicitly changed.

## Checkpoints

## Checkpoint 0: Lock API and Event Contract

### Deliverables

- Define lifecycle phases and status event schema.
- Define IPC surface for phase control and status retrieval.

### TODOs

- [x] Create shared lifecycle types (phase, status, event payload) under `src/shared` or `src/types`.
- [x] Decide channel naming (`lifecycle:event`) and payload shape.
- [x] Decide minimal state model (`idle|running|succeeded|failed` per phase + run pid/running bool).

### Acceptance

- [ ] Team agrees on phase semantics and event schema before service implementation.

## Checkpoint 1: Config Parsing Upgrade (Backward Compatible)

### Deliverables

- `.emdash.json` supports:
  - `scripts.setup?: string`
  - `scripts.run?: string`
  - `scripts.teardown?: string`

### TODOs

- [x] Extend `EmdashScripts` and `EmdashConfig` in `src/main/services/LifecycleScriptsService.ts`.
- [x] Add `getScript(projectPath, phase)`.
- [x] Remove setup-only getter/API surface (`getSetupScript`, `lifecycle:getSetupScript`).
- [x] Update default config template (optional for MVP, recommended).

### Acceptance

- [ ] Existing projects with only `setup` continue to work.
- [ ] Missing `run`/`teardown` does not change behavior.

## Checkpoint 2: Main-Process TaskLifecycleService

### Deliverables

- New service owns process execution/state/events for setup/run/teardown.

### TODOs

- [x] Add `src/main/services/TaskLifecycleService.ts`.
- [x] Implement:
  - [x] `runSetup(taskId, taskPath, projectPath)`
  - [x] `startRun(taskId, taskPath, projectPath)`
  - [x] `stopRun(taskId)`
  - [x] `runTeardown(taskId, taskPath, projectPath)`
  - [x] `getState(taskId)`
- [x] Use `spawn(..., { shell: true, cwd, env })`.
- [x] Keep in-memory maps for:
  - [x] active run process by taskId
  - [x] setup in-flight / completed markers
  - [x] last phase results
- [x] Emit structured events for `starting|line|done|error|exit`.

### Acceptance

- [ ] Run process can be started/stopped reliably.
- [ ] Setup/teardown execute as finite commands with event streaming.

## Checkpoint 3: Lifecycle IPC (Renderer Access)

### Deliverables

- IPC endpoints to control lifecycle from renderer safely.

### TODOs

- [x] Expand `src/main/services/lifecycleIpc.ts` with:
  - [x] `lifecycle:setup`
  - [x] `lifecycle:run:start`
  - [x] `lifecycle:run:stop`
  - [x] `lifecycle:teardown`
  - [x] `lifecycle:getState`
  - [x] `lifecycle:events:subscribe` (if needed) or broadcast channel
- [x] Wire IPC registration in main bootstrap if needed.
- [x] Extend preload API and renderer type declarations.

### Acceptance

- [ ] Renderer can trigger each phase without touching terminal injection APIs.

## Checkpoint 4: Replace Setup Terminal Injection

### Deliverables

- Setup no longer sent with `ptyInput`; now invoked via lifecycle service.

### TODOs

- [x] Update `src/renderer/components/TaskTerminalPanel.tsx` setup flow.
- [x] Replace `lifecycleGetScript(phase=setup) + ptyInput` with `lifecycle:setup`.
- [x] Keep one-time-per-task/worktree behavior in renderer for MVP trigger timing.
- [x] Keep clear logging for setup failures.

### Acceptance

- [ ] Setup runs when expected and does not type into terminal.

## Checkpoint 5: Run Phase Integration

### Deliverables

- Preview/start path honors `scripts.run` first.

### TODOs

- [ ] In `src/main/services/hostPreviewService.ts`, start lifecycle run if configured.
- [ ] Keep existing autodetect fallback (`dev/start/serve/preview`) when no `scripts.run`.
- [ ] Ensure `hostPreviewStop/StopAll` stops lifecycle-managed run for task.
- [ ] Ensure process reuse behavior remains correct when switching worktrees.

### Acceptance

- [ ] Configured `scripts.run` is used by preview flow.
- [ ] Projects without config keep current behavior.

## Checkpoint 6: Teardown on Archive/Delete

### Deliverables

- Teardown executes during destructive task flows.

### TODOs

- [ ] Integrate `lifecycle:teardown` into delete/archive flow in `src/renderer/App.tsx`.
- [ ] Add timeout handling to prevent stuck delete/archive UX.
- [ ] Initial policy: teardown errors warn/log and continue delete/archive.
- [ ] Ensure run process is stopped before/after teardown as needed.

### Acceptance

- [ ] Archive/delete triggers teardown when configured.
- [ ] Failure does not wedge UI flow in MVP.

## Checkpoint 7: Docs and QA

### Deliverables

- User-facing docs for setup/run/teardown semantics and examples.
- Basic verification matrix for core scenarios.

### TODOs

- [ ] Update `docs/content/docs/project-config.mdx` with new script options and behavior.
- [ ] Add examples for:
  - [ ] Node dev server (`run`)
  - [ ] docker compose (`setup` + `teardown`)
  - [ ] no-op fallback behavior
- [ ] Manual verification checklist:
  - [ ] no scripts configured
  - [ ] setup only
  - [ ] run only
  - [ ] setup+run+teardown
  - [ ] archive/delete with teardown failure
  - [ ] task switch stop/start behavior
- [ ] Run quality checks:
  - [ ] `npm run lint`
  - [ ] `npm run type-check`
  - [ ] `npx vitest run`

### Acceptance

- [ ] Docs match shipped behavior.
- [ ] No regressions in current preview/start flows.

## Implementation Notes (KISS)

- Keep per-phase scripts as plain strings in MVP.
- Normalize internally to a small `ResolvedScript` type for future options.
- Avoid introducing DB migrations for lifecycle state in first release.
- Prefer explicit, small methods over abstract workflow engines.
- Keep existing host preview heuristics as fallback path to reduce rollout risk.

## Open Decisions (Resolve Before Checkpoint 5/6)

- [ ] Auto-start policy for `run`:
  - Option A: only when preview/start is requested (lower risk)
  - Option B: auto-start on task readiness (more opinionated)
- [ ] Teardown strictness:
  - Option A: warn and continue delete/archive (MVP default)
  - Option B: block destructive flow on teardown failure
- [ ] Multi-agent run model:
  - Option A: one run per variant/worktree
  - Option B: one run per logical task

## Suggested Execution Order

1. Checkpoint 0
2. Checkpoint 1
3. Checkpoint 2
4. Checkpoint 3
5. Checkpoint 4
6. Checkpoint 5
7. Checkpoint 6
8. Checkpoint 7

## Definition of Done (MVP)

- [ ] Lifecycle phases are config-driven (`setup`, `run`, `teardown`).
- [ ] No setup terminal injection remains.
- [ ] Run process is main-managed and stoppable.
- [ ] Teardown is invoked on archive/delete.
- [ ] Existing projects continue to function without config changes.
