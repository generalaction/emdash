# Operations kernel (`core/src/primitives/kernel/`)

> **Status: design docs only.** Nothing in this folder is implemented yet. These
> documents specify the operations kernel before the first line of code lands,
> the same way `wire/src/state/` was specified. The existing operation
> machinery — the desktop `OperationsEngine`
> (`apps/emdash-desktop/src/core/services/operations/`), the host
> `WorkspaceOperationLog` (`core/src/runtimes/workspace/`), and the shared
> vocabulary in `core/src/primitives/operations/api/` — keeps running unchanged
> until the migration described in [07-engine-and-stores.md](./07-engine-and-stores.md#migration)
> replaces it plane by plane.

The operations kernel is a small set of pure primitives for
**conflict-aware, observable work on named resources** — durable where the
work records intent (mutations), ephemeral where it records observation
(reads). It answers, with one shared mechanism, the questions that today
are answered by several disparate ones:

- *May this work exist?* — admission: dedupe, reject, supersede, or queue an
  incoming operation against everything already in the log.
- *May this work run now?* — dispatch: a claim-compatibility check against the
  currently running set, replacing per-key serial lanes.
- *What is this work doing?* — execution: handlers report stages and progress
  through one uniform live channel instead of ad-hoc status lifting.
- *What happened?* — records: every mutation leaves a durable, queryable row
  with its trigger, claims, attempts, and terminal outcome. The audit log is a
  side effect, not a second system.

The kernel is **pure logic over plain data**: no SQLite, no Wire, no
filesystem, no Electron. Both planes of the app — the desktop's durable ledger
and each host's execution log — run the *same* kernel against different
stores, which guarantees they can never disagree about what conflicts with
what.

## Why

Today the app has several systems that each solve a slice of this problem
with their own vocabulary:

- The desktop `OperationsEngine` has durable rows, per-host serial lanes,
  parent/child trees, and confirmation flows — but exclusivity is implicit
  (one non-terminal operation per resource key), sharing is inexpressible, and
  coarse operations (repo-wide prune, host drain) cannot be modeled without
  enumerating every descendant.
- The host `WorkspaceOperationLog` has its own record shape, its own status
  set, and its own stage lifting from the workflow engine.
- Every feature that needs "don't run these two things at once" re-implements
  the check at its own layer, and every feature that wants progress display
  re-plumbs stages to the renderer.

The kernel moves all of that into one tested core. Feature code is left with
declarations:

```ts
// The whole definition of a destructive operation.
const teardownWorkspace = defineOperation({
  name: 'teardown-workspace',
  input: teardownInputSchema,             // VersionedSchema — durable, upgradeable
  result: teardownResultSchema,
  error: teardownErrorSchema,
  key: (input) => hostResourceKey({ kind: 'worktree', ...input }),
  claims: (input) => worktreeResource.mutates(input),
});

// The whole handler, host side. Stages fall out of how the work is structured.
const teardownHandler = createOperationHandler(teardownWorkspace, async (ctx) => {
  await ctx.stage('scripts', 'Run teardown scripts', () => runTeardownScripts(ctx.input));
  await ctx.stage('worktree', 'Remove worktree', () => removeWorktree(ctx.input));
  await ctx.stage('branch', 'Delete branch', () => deleteBranch(ctx.input));
  return { removed: true };
});

// Submitting from feature code: typed end to end.
const handle = await engine.submit(teardownWorkspace, input, {
  initiator: { kind: 'user', action: 'delete-task' },
});
handle.follow((progress) => render(progress.stages));
const result = await handle.result; // Result<TeardownResult, TeardownError>
```

## The components at a glance

| Component | One-liner | Doc |
|---|---|---|
| `ClaimMode` / matrix | Four descriptive modes (`shared`, `exclusive`, `intent-shared`, `intent-exclusive`) and one compatibility table shared by admission and dispatch | [02](./02-resources-and-claims.md#modes) |
| `defineResource` | Declares a claimable resource with a parent link; `reads()`/`mutates()` expand to the full MGL claim set including ancestor intents | [02](./02-resources-and-claims.md#defineresource) |
| `ResourceClaim` | Plain data: `{ resource, key, mode, implicit }` — frozen at admission, read by dispatch and the UI | [02](./02-resources-and-claims.md#claims-are-data) |
| `defineOperation` | The SPI: name, versioned input, typed result/error, dedupe key, claims, durability tier. One definition object used for submission, conflicts, and registration | [03](./03-operations.md#defineoperation) |
| `OperationRecord` | The record: input, claims, status, parent, initiator, attempts, terminal outcome summary — same shape in both durability tiers | [03](./03-operations.md#the-record) |
| `defineConflictPolicy` | Central table of resolutions (`dedupe`/`reject`/`supersede`/`queue`) between definition pairs whose claims collide | [04](./04-admission-and-conflicts.md#the-policy-table) |
| `admit` | Pure admission decision against the non-terminal set; each plane wraps it in its own transaction | [04](./04-admission-and-conflicts.md#admit) |
| `RunningClaims` / `dispatchPass` | Matrix-gated dispatch with fairness barriers and read-class capacity limits; degenerates to keyed lanes when every claim is exclusive | [05](./05-dispatch.md) |
| `createOperationHandler` | Execution SPI: `run(ctx)` with `ctx.stage()`, progress reporting, and cancellation via `AbortSignal` | [06](./06-execution-and-handlers.md#createoperationhandler) |
| `ctx.run` / `ctx.spawn` | Child operations from inside handlers; `ctx.run` awaits the typed result, making imperative coordinators durable via key-dedupe rather than replay | [06](./06-execution-and-handlers.md#ctxrun-and-ctxspawn-operations-from-inside-handlers) |
| `OperationProgress` | The live stage/progress shape; streamed via a `ProgressSink`, never persisted (records keep a compact terminal summary) | [06](./06-execution-and-handlers.md#stages-and-progress) |
| `OperationStore` | The persistence port; one SQLite implementation shared by both planes for durable records, with the memory store doubling as the production ephemeral tier | [07](./07-engine-and-stores.md#the-store-port) |
| Transition journal | `operation_transitions` rows appended with every CAS — the operation timeline for display/debugging and the poke source for read models | [07](./07-engine-and-stores.md#the-transition-journal) |
| `createOperationEngine` | Composition root: admission + dispatch + execution + retry + recovery over a store and a registry | [07](./07-engine-and-stores.md#the-engine) |
| `engine.query()` / folds | The read path: filter-shaped queries over records and claims, plus pure display folds (`displayStatus`, `activityFeed`, `operationTreeView`, `provenanceChain`) | [09](./09-querying-and-display.md) |

## What the kernel is not

- **Not a transport.** Wire contracts, live-model plumbing, and
  desktop-to-host submission stay at the app edges. The kernel defines the
  *shapes* that travel (records, progress), not how they travel.
- **Not a persistence layer.** It defines the `OperationStore` port; the
  shared SQLite adapter lives with its owners.
- **Not the physical truth.** Claims are advisory coordination of *intent*.
  The final guard is always the handler re-checking reality (does the
  worktree still exist? is the branch merged?) before acting. Probing and
  idempotency strategies are internal to handlers, invisible to the kernel.
- **Not a session supervisor.** Long-lived processes (agent sessions,
  terminals, dev servers) are supervised resources, not operations. The rule:
  every programmatic *mutation* is an operation; every programmatic *process*
  is a supervised consumer with a small operation at its birth.
- **Not a UI.** Display statuses (`queued`, `running`, `waiting for 2 scans
  on feat-x`) are derived projections owned by feature code.

## Reading order

1. [01-concepts.md](./01-concepts.md) — the mental model: the two planes,
   ownership taxonomy, advisory claims vs physical guards, and the life of an
   operation end to end.
2. [02-resources-and-claims.md](./02-resources-and-claims.md) — resources,
   claim modes, the compatibility matrix, and multi-granularity claim
   expansion.
3. [03-operations.md](./03-operations.md) — operation definitions, records,
   statuses, identity, and parent/child trees.
4. [04-admission-and-conflicts.md](./04-admission-and-conflicts.md) — the
   conflict policy table and the pure admission function.
5. [05-dispatch.md](./05-dispatch.md) — matrix-gated dispatch: the algorithm,
   fairness, capacity limits, restart, and when to use it vs plain lanes.
6. [06-execution-and-handlers.md](./06-execution-and-handlers.md) — handlers,
   stages, progress, retries, cancellation, and physical guards.
7. [07-engine-and-stores.md](./07-engine-and-stores.md) — the engine
   composition, the store port, registration, recovery, testing, and the
   migration plan.
8. [08-usage-patterns.md](./08-usage-patterns.md) — the cookbook: worked
   patterns for destructive operations, shared scans, coordinators
   (declarative and imperative), supersession, queueing, and cross-plane
   submission.
9. [09-querying-and-display.md](./09-querying-and-display.md) — the read
   path: CQRS framing, `engine.query()`, the pure display folds, wire
   exposure, reactive queries fetching through ephemeral read operations,
   and retention.

## Design lineage

The kernel is a deliberate synthesis of three production lineages, each
validating one leg of the design:

- **OpenVMS / Linux DLM** — the mode-compatibility matrix over a resource
  hierarchy with intent modes, lifted out of the database and used to
  coordinate arbitrary named resources cluster-wide for four decades. Our
  four modes are their `PR/EX/CR/CW` with readable names; their lesson that
  most consumers never used more than three modes is why we resist adding a
  fifth.
- **Google Chubby** (Burrows, OSDI 2006) — coarse-grained, *advisory* locks
  held for the duration of long jobs, with safety coming from fencing at the
  resource rather than from the lock service. That maps exactly onto our
  advisory claims plus handler-side physical guards.
- **CI resource locking** (Jenkins Lockable Resources, GitLab
  `resource_group`, GitHub Actions `concurrency`) — the use case: durable
  jobs claiming named resources, with queue-or-cancel semantics. They prove
  the demand; DLM provides the richer mechanism they lack.

From Kubernetes we keep `ownerReferences` (operation parenting and cascading
adoption) and the finalizer intuition (claims block destruction); from
Temporal the durable-record-plus-idempotent-handler split; from BullMQ the
parent/child completion propagation.
