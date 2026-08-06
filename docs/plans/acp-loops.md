# Loops: autonomous phased plan execution in emdash (ACP-first, experimental)

> **Historical v1 plan.** The authoritative resolved product and multi-agent execution plan is
> [`acp-loops-v2-codex-orchestration.md`](./acp-loops-v2-codex-orchestration.md). This file retains
> earlier design history, including now-superseded Agent Browser, local-`cwd`, per-phase review,
> separate modal/sidebar, and Summario acceptance assumptions. Do not execute it as the current plan.
> Start execution from the concise
> [`acp-loops-v2-codex-handoff.md`](./acp-loops-v2-codex-handoff.md).

## Overview

Port the executr/ralphex workflow into emdash as a first-class experimental feature called
**Loops**. A loop is a phased plan attached to a project/task. Each phase runs in a fresh agent
session (a conversation thread named `<loop-slug>-<n>`, e.g. `agent-loops-1`), must satisfy
**enforced pass criteria**, is verified in layers (unit tests first, then e2e via user-selected
verifier tools: `gh`, `vercel`, `convex`, `agent-browser`), and can optionally be gated by a
review agent. A "Loops" section sits at the top of the task sidebar (above threads) with a loop
icon; clicking it opens a control-panel view with phase/task overview and live progress.

## Context

- Base branch: `fork/add-acp-support-platform` (superset of main; monorepo layout,
  `apps/emdash-desktop/`, packages incl. `packages/core` with full ACP runtime).
- ACP is wired end-to-end for the `claude` provider only: `conversations.type = 'acp'`,
  `rpc.acp.{prompt,cancel,getChatHistory,getSessionState,...}`,
  `apps/emdash-desktop/src/main/core/acp/acp-session-manager.ts`,
  `packages/core/src/acp/acp-session-runtime.ts`.
- Conversations can be driven fully headless from main: `createConversation` →
  `hydrateConversation` → (`acpSessionManager.start` | PTY `startSession`).
- Settings live in DB `app_settings` with zod schema
  `apps/emdash-desktop/src/main/core/settings/schema.ts`; no experiments key exists yet.
- New tables go in `apps/emdash-desktop/src/main/db/schema.ts` + `pnpm run db:generate`;
  never hand-edit `drizzle/` migrations. Versioned JSON columns via `versionedJsonColumn()`.
- Views register in `src/renderer/app/view-registry.ts`, modals in
  `src/renderer/app/modal-registry.ts`; task sidebar is
  `src/renderer/features/tasks/view/task-sidebar.tsx` (Loops section goes above
  `<SidebarConversationsList/>`).
- ralphex semantics to preserve: one phase = one fresh session; `- [ ]` checkboxes; validation
  commands re-run per phase; honesty rules (never mark unmet criteria as passed; record exact
  blockers); fail after 3 honest attempts; review rounds after tasks; browser verification is a
  gate, not advice.

## Product Decisions

- Feature name: **Loops**. Entirely behind `appSettings.experiments.loops` (default `false`).
  With the flag off, no UI, no RPC side effects, no schema behavior change for existing users.
- A loop belongs to a task (workspace/worktree). Creating a loop = pick name, define phases
  (name, goal, pass criteria), select verifier tools from a list (`gh`, `vercel`, `convex`,
  `agent-browser` — multi-select), toggle review agent.
- Unit tests are ALWAYS the first verification layer for every phase (non-optional).
- Each phase runs in a NEW session/thread named `<loop-slug>-<n>` (1-based), visible in the
  normal threads list; the Loops overview links to them.
- Phase pass = agent reports done AND validation commands green AND per-phase criteria verified
  e2e with the selected verifiers AND (if enabled) review agent approves. Otherwise retry in the
  same phase (max 3 attempts) then mark phase failed and pause the loop.
- Loop statuses: `draft | running | paused | failed | completed`. Phase statuses:
  `pending | running | verifying | reviewing | passed | failed`.

## Architecture Decisions

- Main process: new domain `apps/emdash-desktop/src/main/core/loops/` with
  `controller.ts` (RPC: create/get/list/start/pause/resume/cancel/retryPhase/delete),
  `loop-service.ts` (singleton orchestrator), `phase-runner.ts`, `prompt-builder.ts`,
  `verifiers/registry.ts` + one module per verifier, `operations/*` for DB access.
  Register as `loops:` in `src/main/rpc.ts`. Expected failures return `Result<T, E>`.
- Session driving: a `LoopSessionDriver` interface with two impls:
  - `acp-driver.ts` (primary): creates a `type: 'acp'` conversation (provider `claude`),
    awaits `rpc`-level prompt completion via `acpSessionManager` (`prompt()` resolves on turn
    end), reads final state via `getChatHistory`.
  - `pty-driver.ts` (scaffold): compiles + typechecks, registered in the driver registry, but
    returns a typed `err({ kind: 'not-implemented' })` — documented as the extension point for
    non-ACP providers. This is the "mock missing parts sensibly" requirement.
- Verifiers are executed from the main process in the workspace worktree cwd via
  `child_process` (not PTY UI terminals), with captured stdout/stderr stored per phase:
  - `unit-tests` (implicit, always first): runs the plan's validation commands.
  - `gh`: `gh run list`/`gh pr checks` style CI-green checks.
  - `vercel`: latest deployment status for the linked project.
  - `convex`: `npx convex deploy --dry-run` (schema/function validation).
  - `agent-browser`: drives the app UI (dev server or CDP target) to verify the phase's
    e2e criteria; snapshot/screenshot evidence path stored.
  Each verifier module: `{ id, label, checkAvailability(cwd), run(ctx): Promise<Result<Evidence, VerifierError>> }`.
  Availability is surfaced in the create-loop modal (unavailable tools shown disabled).
- Phase prompt (prompt-builder) is ralphex-style: ANNOUNCE → IMPLEMENT (write unit tests
  first/alongside) → VALIDATE (run validation commands until green) → report with sentinel
  `<<<LOOP:PHASE_DONE>>>` or `<<<LOOP:PHASE_FAILED reason>>>`. The engine then runs the
  verifier gate itself; agent claims alone never pass a phase.
- Review gate: when enabled, a fresh ACP session (thread `<loop-slug>-<n>-review`) receives a
  review prompt over the phase diff; sentinel `<<<LOOP:REVIEW_APPROVED>>>` or
  `<<<LOOP:REVIEW_CHANGES ...>>>`; CHANGES feeds back into a retry attempt.
- DB: `loops` table (id, projectId, taskId, name, slug, status, currentPhaseIndex,
  config versionedJsonColumn: verifiers[], reviewEnabled, validationCommands[], planSource) and
  `loop_phases` (id, loopId, idx, name, goal, status, attempts, conversationId,
  criteria versionedJsonColumn: [{ description, verifier, status, evidence }],
  lastError, timestamps). Typed events `loop:updated`, `loop:phase-updated` to renderer.
- Renderer: `src/renderer/features/loops/` — `loops-store.ts` (rpc + events),
  `create-loop-modal.tsx`, `loop-view.tsx` (control panel: phase list, criteria checklists,
  verifier evidence, live status, pause/resume/cancel/retry buttons, links to phase threads),
  `sidebar-loops-section.tsx` (top of task sidebar, loop icon, name + progress). Registered in
  view-registry (`loop`), modal-registry (`createLoopModal`); all rendering gated on the
  experiments flag.

## Verification Contract

- Every phase of THIS plan is itself verified: typecheck + lint + unit tests green, and the
  feature exercised e2e in the running Electron app via CDP (`--remote-debugging-port=9222` +
  `agent-browser connect 9222` or chrome-devtools MCP) with screenshots/snapshots as evidence.
- Final acceptance: two real loops executed through the emdash UI against
  `~/projects/summario` — (1) cookie consent banner, (2) privacy policy page — each producing
  a verified branch/PR with green validation.

## Validation Commands

- `pnpm run typecheck`
- `pnpm run lint`
- `pnpm run test`
- (db changes) `pnpm run test:migrations`

### Task 1: Schema, settings flag, shared types

- [ ] Add `experiments: { loops: boolean }` (default false) to app settings schema + shared types
- [ ] Add `loops` and `loop_phases` tables to `src/main/db/schema.ts` with versioned JSON columns
      (`loopConfig`, `loopPhaseCriteria`) defined under `src/shared/`
- [ ] Generate migration via `pnpm run db:generate`; update fixtures/migration tests as required
- [ ] Shared loop domain types + zod validation in `src/shared/core/loops/`
- [ ] Unit tests for versioned schemas and type guards
- [ ] Run validation commands

### Task 2: Main-process loop engine

- [ ] `src/main/core/loops/` domain: operations (CRUD), loop-service singleton, controller,
      registered in `rpc.ts`; typed events `loop:updated` / `loop:phase-updated`
- [ ] Verifier registry + `gh`, `vercel`, `convex`, `agent-browser`, `unit-tests` modules with
      availability checks and evidence capture (child_process in worktree cwd)
- [ ] `prompt-builder.ts` (ralphex-style phase prompt + review prompt, sentinels)
- [ ] `LoopSessionDriver` with ACP driver (fresh conversation `<slug>-<n>`, await turn end,
      history extraction) and PTY scaffold driver returning typed not-implemented
- [ ] `phase-runner.ts` state machine: attempt loop (max 3), verifier gate, optional review gate,
      loop status transitions, persistence after every transition (crash-safe resume on app boot)
- [ ] Unit tests: state machine transitions, prompt builder, verifier registry (spawn mocked),
      sentinel parsing, resume-from-db
- [ ] Run validation commands

### Task 3: Renderer UI

- [ ] `loops-store.ts` + RPC/event wiring
- [ ] `create-loop-modal.tsx`: name, phases editor (name/goal/criteria), verifier multi-select
      list with availability states, review-agent toggle; registered in modal-registry
- [ ] `loop-view.tsx` control panel registered in view-registry: phases + criteria + evidence,
      live progress, pause/resume/cancel/retryPhase, links to phase threads
- [ ] `sidebar-loops-section.tsx` at top of task sidebar above threads, loop icon, progress pill;
      gated on experiments flag; settings UI toggle under an "Experimental" section
- [ ] Renderer tests for store mapping + basic component render
- [ ] Run validation commands

### Task 4: Self e2e verification

- [ ] Launch built app with `--remote-debugging-port=9222`, connect agent-browser/CDP
- [ ] Enable experiments.loops via settings UI; create a demo loop on a scratch repo with a
      trivial 2-phase plan; observe: thread naming `<slug>-1`, phase pass with unit-test layer,
      verifier evidence rendered, loop completes; capture screenshots
- [ ] Fix everything found; re-run validation commands

### Task 5: Real-world acceptance on summario

- [ ] Loop `cookie-consent` on `~/projects/summario`: implement cookie consent banner
      (verifiers: agent-browser + gh; convex if schema touched)
- [ ] Loop `privacy-policy` on `~/projects/summario`: implement privacy policy page
- [ ] Both loops driven through the emdash UI end-to-end, producing verified branches/PRs

## Success Criteria

- Experiments flag off → app indistinguishable from base branch (no loops UI/RPC surface used).
- Flag on → full create → run → verify → review → complete lifecycle works with ACP sessions.
- No weakening of PTY env allowlists, shell escaping, or path safety.
- All validation commands green; e2e evidence recorded under `.emdash-loops-evidence/`.
