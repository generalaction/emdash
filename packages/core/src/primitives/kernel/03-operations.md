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
   * Terminal payloads. Plain zod, deliberately *not* versioned: they are
   * delivered to the awaiting handle, not durably stored — anything worth
   * remembering goes into the versioned outcome summary via ctx.fact()
   * (see §the-record for the rationale and the promotion path).
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
- **`id`** is *record identity* — a unique ULID per admission, used for
  parenting, progress streams, cancellation, and history.

The key convention matters for dedupe correctness: it must include
everything that distinguishes distinct work (host, path) and exclude
anything incidental (timestamps, initiators, retry counts).

## The record

The durable shape both planes' stores must hold:

```ts
export interface OperationRecord {
  id: string;                   // ULID, unique per admission
  seq: number;                  // monotonic per store — dispatch fairness order
  name: string;                 // definition name
  key: string;                  // work identity (dedupe)
  input: unknown;               // versioned JSON; parse via definition.input
  claims: ResourceClaim[];      // frozen at admission

  status: OperationStatus;
  attempt: number;              // 0-based; incremented per handler retry

  parentId?: string;            // operation tree (see below)
  initiator: OperationInitiator;// who/what asked — user action, automation,
                                // reconciler proposal, parent operation

  error?: OperationErrorSummary;       // present in failed/rejected
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
- `outcome` is also the **one durably versioned shape** on the settlement
  path: it carries a light versioned envelope (one shared version map, not
  one per definition), while `result`/`error` stay plain zod. The asymmetry
  with `input` is principled: a stored *input* is **executed** by future
  code — an upgrade function must produce something the new handler can act
  on, so versioning is a correctness requirement. A stored *outcome* is only
  ever **displayed or inspected** — an unparseable three-versions-old
  summary can render as "completed (details unavailable)" with zero harm.
  Handlers route anything durable through `ctx.fact()`; if a specific
  definition ever genuinely needs its full result durable and upgradeable,
  promote that one definition's `result` to a `VersionedSchema` — nothing
  blocks it.
- `seq` comes from the store (SQLite rowid / host log counter). It is the
  total order dispatch fairness relies on; it never travels across planes.

## Statuses

One closed status machine, shared by both planes:

```text
                        ┌────────────────────────────► superseded (terminal)
                        │
 submit ──► pending ────┼──► running ──► succeeded (terminal)
                        │      │  ▲
                        │      │  └── pending      (retry with backoff, attempt++)
                        │      ├──► failed         (terminal — attempts exhausted)
                        │      ├──► rejected       (terminal — physical guard refused;
                        │      │                     retrying cannot help)
                        │      └──► cancelled      (terminal — user/parent abort)
                        │
                        └──► cancelled (terminal — cancelled while waiting: row
                                        settles without ever running)

 parent-only:  running ──► waiting-children ──► succeeded | failed
               (own work done; settles when all children settle, per its
                propagation policy)
```

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
