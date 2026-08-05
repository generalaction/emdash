# Host-side workspace registry with plain-RPC lifecycle verbs

Each host runs a workspace registry: a sole-writer runtime over its own durable store, holding
registered paths plus host-computed observations (branch, dirty, ahead/behind, changed lines
including untracked files), published to desktops through a single `records` live model that
merges the durable rows with an in-memory runtime overlay (creation progress, activation state,
notices). The filesystem remains the source of truth — the registry observes it and auto-adopts
worktrees of registered repositories; it never converges the world toward a record (ADR 0001's
host-authoritative stance is unchanged). The desktop keeps its mirror + annotations and applies
each delivery as a full snapshot through the registry sole writer (ADR 0002's verbs stay).

Workspace lifecycle is six task-independent verbs — `createWorkspace`, `createWorktree`,
`activateWorkspace`, `deactivateWorkspace`, `deleteWorkspace`, `deleteWorktree` — modeled as
**plain wire RPCs**. This supersedes ADR 0001's transport clause ("mutating host state happens
only through one-shot durable commands in an outbox") for workspace mutations: no inbox/outbox,
no durable operation log, no liveJob endpoints. Handlers still use kernel claims (exclusive
per-repository for worktree create/delete, per-workspace for activate/deactivate/delete).

## Why plain RPCs

The outbox existed to survive two gaps: desktop-to-host disconnection at enqueue time, and
daemon interruption mid-execution. Both are now handled without durable commands:

- **Unreachable host → fail fast.** Every verb returns a typed `host-unreachable` error and this
  design queues nothing. A workspace-specific pending-intents queue ("mini-outbox") was
  considered and rejected: it reintroduces the exact machinery this design removes. "Removal
  pending" leaves the workspace vocabulary. The system-wide offline-delete answer — durable
  client-side tombstones swept by an entity-generic reconcile loop (operation-log-retirement
  effort) that calls these delete verbs when the host is reachable — composes with this contract
  rather than changing it; idempotent deletes are what make that sweep safe to repeat.
- **Interruption → durable fact records, client-driven retry.** `createWorktree` registers its
  record at the start (`lastCreateOutcome: 'started'`) and records `succeeded` or
  `failed(stage, error)` durably. An interrupted creation is visible in the registry after
  restart; recovery is a client replay (same UUID + identical immutable spec re-executes;
  a succeeded one no-ops; a divergent spec errors). The host never re-converges on its own —
  outcomes are facts, not desired state.

Progress needs no job objects: callers watch the `records` live model, whose runtime overlay
carries creation stage and activation script states. After a daemon restart the overlay is
simply absent — activation is ephemeral by design (`lastActivatedAt` is an observation, never
a durable "active" flag).

## Consequences

- `deactivateWorkspace` is the sole owner of kill-sessions + time-boxed non-fatal teardown;
  the delete verbs compose it server-side. This retires ADR 0003 (teardown inside the
  removeWorktree verb): 0003's rationale was the queued-offline removal, which no longer exists.
- Deletes are idempotent (absent id succeeds) and never refuse for dirty/unpushed state;
  informed confirmation is the client's job, powered by mirror observations — no preflight RPC.
- `deleteWorkspace` never touches disk; `deleteWorktree` is the only artifact-destroying verb.
- Desktop-side scan tiers, the workspace snapshot pull sync, and the workspace outbox
  definitions retire; freshness (fs-events primary, activity-gated escalation, polling floor,
  explicit refresh verb) is a host concern.
- Retiring the outbox for anything else (conversations delete) is a separate effort; until then
  the two transports coexist, scoped by domain.
