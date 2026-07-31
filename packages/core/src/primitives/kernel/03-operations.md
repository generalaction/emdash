# Operations

The operation definition is the kernel's SPI: one frozen object per kind of
work, used as the type anchor for submission, the key in the conflict policy,
and the registration unit for handlers. The record is its durable footprint.

## `defineOperation`

```ts
export function defineOperation<TName extends string, TInput, TResult, TError>(spec: {
  /** Unique kind name. Stable — it is stored on every record. */
  name: TName;

  /**
   * Input schema as a VersionedSchema, not a bare zod type. Inputs are
   * durable: a pending operation written by app version N may be dispatched
   * by version N+3 after upgrades ran. Versioned schemas give stored inputs
   * the same upgrade path as every other versioned JSON column.
   */
  input: VersionedSchema<TInput>;

  /**
   * Terminal payloads. Persisted on the record as loose JSON and validated
   * against these schemas at read time; deliberately *not* versioned — a
   * parse failure after an app upgrade degrades to status + the versioned
   * outcome summary (see §the-record for the rationale and the
   * verdict-not-payload rule that keeps these small).
   */
  result: z.ZodType<TResult>;
  error: z.ZodType<TError>;

  /**
   * Dedupe identity. Two submissions with equal keys are the *same work*:
   * admission returns the existing handle instead of inserting a second row.
   * Convention: derive from the primary resource key, optionally suffixed
   * ('teardown:' + worktreeKey).
   */
  key: (input: TInput) => string;

  /**
   * The full claim set, built via resource definitions
   * (worktreeResource.mutates(...), repoResource.reads(...)). Computed once
   * at admission and frozen on the record.
   */
  claims: (input: TInput) => ResourceClaim[];

  /**
   * Optional pure display label ('Tear down feat-x'). Keeps input parsing
   * out of UI code — display surfaces call definition.describe(input)
   * instead of reaching into per-kind payload shapes.
   */
  describe?: (input: TInput) => string;

  /** Retry policy for handler failures. Default: no retries. */
  retry?: RetryPolicy; // { maxAttempts: number; backoff: BackoffSpec }
}): OperationDefinition<TName, TInput, TResult, TError>;
```

The returned `OperationDefinition` is a frozen value. Its type parameters
flow through everything downstream:

```ts
type InputOf<D>  = D extends OperationDefinition<any, infer I, any, any> ? I : never;
type ResultOf<D> = D extends OperationDefinition<any, any, infer R, any> ? R : never;
type ErrorOf<D>  = D extends OperationDefinition<any, any, any, infer E> ? E : never;

engine.submit(teardownWorkspace, input /* : TeardownInput, checked */);
// handle.result : Promise<Result<TeardownResult, TeardownError>>
```

### What the definition deliberately does *not* contain

Each omission was a design decision; keep them omitted:

- **No `conflictPolicy` field.** A conflict is a relation *between two*
  definitions; putting it on one creates circular imports between definition
  modules and hides the global picture. The central
  [`defineConflictPolicy`](./04-admission-and-conflicts.md#the-policy-table)
  table owns it.
- **No `liveModel` / progress declaration.** Progress has one uniform shape
  ([`OperationProgress`](./06-execution-and-handlers.md#stages-and-progress));
  stages fall out of how the handler structures its work via `ctx.stage`.
  Per-definition progress schemas would fragment the UI for no gain.
- **No `probe` / precondition hook.** Physical guards are the handler's first
  act, expressed in ordinary code. Probing is an idempotency *strategy*, not
  a system feature.
- **No handler.** Definitions are portable (imported by desktop UI for typed
  submission, by the host for execution); handlers pull in Node/host-only
  code. `createOperationHandler(definition, run)` binds them at the execution
  edge only.

## Identity: `key` vs `id`

Every record has both, and they answer different questions:

- **`key`** is *work identity* — "is this the same job?". Admission dedupes
  on it among non-terminal records. After the work settles, the same key may
  be submitted again (you can tear down, re-provision, and tear down the
  same path).
- **`id`** is *record identity* — an opaque unique string per admission
  (a UUID is sufficient; ordering lives in `seq`), used for parenting,
  progress streams, cancellation, and history.

## Key conventions and coalescer contracts

Because dedupe, supersede, and adoption are all coalescing on `key`
([01 §identity](./01-concepts.md#durable-identity-is-the-unifying-mechanism)),
key design is the load-bearing wall every one of those guarantees routes
through. The conventions:

- **Derive keys from the resource key plus a verb prefix**
  (`teardown:${worktreeKey}`, `git-stats:${worktreeKey}`). The resource key
  carries everything that distinguishes distinct work (host, path); the
  prefix separates different work on the same resource.
- **Never include clocks or randomness.** A timestamp in a key silently
  disables every coalescing behavior; randomness turns dedupe into a no-op.
  Likewise exclude anything incidental — initiators, retry counts.

Two contracts follow from coalescing, and both must be understood by every
key author:

- **Winner's input.** A deduped submitter attaches to the *first*
  submission's record — the work runs with the winner's input, not the
  newcomer's. Therefore the key must encode everything that distinguishes
  materially different work: if two inputs would produce different effects,
  they must produce different keys. (Equal keys with differing incidental
  input is by design, and pinned by test.)
- **Read freshness.** A coalesced read (a scan deduping into an in-flight
  scan) reflects state **no older than the coalesced operation's start** —
  a caller who needs "state as of *now*" may receive "state as of a moment
  ago". Where that is not acceptable, the escape hatch is an epoch in the
  key (`git-stats:${worktreeKey}:${epoch}`), rolling the epoch when
  freshness demands it — a deliberate, visible opt-out of coalescing.

## The record

The durable shape both planes' stores must hold:

```ts
export interface OperationRecord {
  id: string;                   // opaque unique string per admission (seq carries order)
  seq: number;                  // monotonic per store — dispatch fairness order
  name: string;                 // definition name
  key: string;                  // work identity (dedupe)
  input: unknown;               // versioned JSON; parse via definition.input
  claims: ResourceClaim[];      // hydrated by join from operation_claims (02)

  status: OperationStatus;
  attempt: number;              // 0-based; incremented per handler retry
  notBefore?: number;           // retry eligibility — dispatch skips until then

  parentId?: string;            // operation tree (see below)
  initiator: OperationInitiator;// who/what asked — user action, automation,
                                // reconciler proposal, parent operation

  result?: unknown;             // persisted on succeeded; validate via definition.result
  rejectedError?: unknown;      // persisted on rejected; validate via definition.error
  error?: OperationErrorSummary;       // present in failed (and wraps aborts)
  outcome?: OperationOutcomeSummary;   // compact terminal summary:
                                       // { failedStage?, completedStages, facts? }

  createdAt: number;
  updatedAt: number;
}
```

Notes on the deliberate shapes:

- `input` is stored as the raw versioned blob and parsed through
  `definition.input` at read time, so records written before a schema bump
  upgrade transparently.
- `claims` being stored (not derived) is what lets the UI answer "what is
  holding this workspace" and lets dispatch run without touching definitions.
- `outcome` is the *only* stage data that persists — the compact terminal
  summary. Live stage streams are ephemeral
  ([06 §stages](./06-execution-and-handlers.md#stages-and-progress)).
- **`result` and `rejectedError` are persisted, loose, and unversioned;
  `outcome` is the one versioned shape.** The persisted payloads are stored
  as raw JSON and validated against `definition.result` / `definition.error`
  at read time. The load-bearing consumer is a crashed imperative
  coordinator resuming via `ctx.run`
  ([06 §ctx.run](./06-execution-and-handlers.md#ctxrun-and-ctxspawn-operations-from-inside-handlers)):
  dedupe returns the settled child, and the parent's code needs the *typed*
  value — routing it through facts would recreate an untyped result store.
  They stay unversioned because a stored *input* is **executed** by future
  code (versioning is a correctness requirement), while a stale result that
  no longer parses degrades to status + the versioned `outcome` with zero
  harm. What keeps them small is the **verdict-not-payload rule**: results
  are verdicts (`{ removed: true }`, `{ prUrl }`); bulk observation data
  (scan output, measurements) goes to the read model the operation
  refreshes, never into the record.
- `seq` comes from the store (SQLite rowid / host log counter). It is the
  total order dispatch fairness relies on; it never travels across planes.

## Statuses

One closed status machine, shared by both planes:

```text
                        ┌────────────────────────────► superseded (terminal)
                        │
 submit ──► pending ────┼──► running ──► succeeded (terminal)
                        │      │  ▲
                        │      │  └── pending      (retry with backoff / crash reset /
                        │      │                     graceful shutdown — attempt++ only
                        │      │                     on retry, never on reset)
                        │      ├──► failed         (terminal — attempts exhausted)
                        │      ├──► rejected       (terminal — physical guard refused;
                        │      │                     retrying cannot help)
                        │      ├──► cancelled      (terminal — chosen abort, reason
                        │      │                     'cancel': user or parent cascade)
                        │      └──► superseded     (terminal — aborted with reason
                        │                            'supersede'; see 04 §the-verbs)
                        │
                        └──► cancelled (terminal — cancelled while waiting: row
                                        settles without ever running)

 parent-only:  running ──► waiting-children ──► succeeded | failed
               (own work done; settles when all children settle, per its
                propagation policy)
```

Note that `running → pending` is one edge serving three causes — retry with
backoff, crash reset at recovery, and graceful shutdown — distinguished by
the transition's recorded cause ([07 §store port](./07-engine-and-stores.md#the-store-port)),
and that `running → superseded` exists so an aborted incumbent's terminal
status records *what actually happened* (it was superseded), never a
generic `cancelled` ([06 §abort reasons](./06-execution-and-handlers.md#abort-reasons)).

- **Terminal set**: `succeeded`, `failed`, `rejected`, `cancelled`,
  `superseded`. Terminal records release their claims by definition — the
  non-terminal set *is* the claim table.
- **`failed` vs `rejected`** is the retryability split: `failed` means the
  attempt errored (network, script exit code) and retrying might help;
  `rejected` means reality disagreed with the intent (path already gone,
  branch not merged without force) and retrying is pointless without a
  changed input.
- **There is no stored `waiting-for-resource` status.** A queued-behind
  operation is simply `pending`; the "waiting for 2 scans on feat-x" display
  is derived by intersecting its claims with the running set
  ([05 §derived waiting](./05-dispatch.md#the-derived-waiting-state)).
- Every store write is a compare-and-swap
  (`transition(id, from, to, patch)`) — an illegal transition is a returned
  `false` and a logged invariant breach, never a silent overwrite.

Status guards elsewhere in the app follow the existing repo rule: check
`isTerminalStatus(s)` / `s !== 'running'`, never enumerate the complement.

## Initiators: every operation knows why it exists

`initiator` is the provenance chain the UI uses to answer "why is this
happening?" — tracing a worktree teardown back to the project deletion that
spawned it:

```ts
export type OperationInitiator =
  | { kind: 'user'; action: string }               // 'delete-task', 'prune-repo'
  | { kind: 'operation'; operationId: string }     // spawned by a parent
  | { kind: 'automation'; automationId: string }
  | { kind: 'reconciler'; probe: string };         // host-proposed cleanup
```

Child operations get `{ kind: 'operation', operationId: parent.id }`
automatically; the *root* initiator is reachable by walking `parentId`, so
display code can always render "Tearing down feat-x — part of deleting
project Acme".

## Operation trees

`parentId` builds trees for coordinated work (delete a project → delete each
task → tear down each workspace). The kernel's rules, borrowed from the
BullMQ/Kubernetes lineage:

- **A parent enters `waiting-children`** when its own work is done but
  children are non-terminal. It settles when the last child settles.
- **Propagation is declared, not implied.** The parent's submission declares
  what child failure means: `fail-parent` (any child failure fails the
  parent), `tolerate` (parent succeeds with a partial outcome summary), or
  custom aggregation in the parent's handler. Cancellation flows *down*
  (cancelling a parent cancels its non-terminal children); it never flows up.
- **Adoption**: a parent submitted while matching orphan operations exist
  (e.g. a project delete finding an older, still-pending workspace teardown)
  may adopt them as children instead of duplicating work — this is an
  admission-time concern, see [04](./04-admission-and-conflicts.md#adoption).
- **Roll-up status** for display uses severity ordering over the subtree
  (the existing `operation-tree.ts` logic carries over unchanged).

Trees are *coordination*, not transactions: children are individually
durable and individually retryable. All-or-nothing semantics exist only at
batch admission ([04 §batch](./04-admission-and-conflicts.md#batch-admission));
execution-time atomicity across irreversible external effects is impossible
and the kernel does not pretend otherwise — compensation is a handler
pattern ([08](./08-usage-patterns.md#compensation)).
