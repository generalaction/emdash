# Engine and stores

The engine is the only effectful component: it sequences admission,
dispatch, execution, retries, and recovery over three ports —
`OperationStore` (persistence), `ProgressSink` (live progress), and `Clock`
(time). Everything it sequences is a pure function from the previous
documents, which is why the entire lifecycle runs in a unit test against an
in-memory store with a fake clock.

## The store port

The seam that keeps the kernel pure and lets both planes (plus tests) share
one engine:

```ts
export interface OperationStore {
  /** Serialized read-modify-write; the transactionality admission relies on. */
  transaction<T>(fn: (tx: OperationStoreTx) => T): Promise<T>;

  listNonTerminal(): Promise<OperationRecord[]>;
  listPending(): Promise<OperationRecord[]>;      // dispatch candidates, seq order
  get(id: string): Promise<OperationRecord | undefined>;
  listByParent(parentId: string): Promise<OperationRecord[]>;
}

export interface OperationStoreTx {
  insert(record: NewOperationRecord): OperationRecord;   // store assigns seq

  /**
   * Compare-and-swap status transition. Returns false (and writes nothing)
   * if the record's current status ≠ from — the store-level enforcement of
   * the status machine.
   */
  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    patch?: Partial<Pick<OperationRecord, 'attempt' | 'error' | 'outcome' | 'parentId'>>
  ): boolean;

  markSuperseded(ids: string[]): void;
  reparent(id: string, parentId: string): void;          // adoption
  listNonTerminal(): OperationRecord[];                   // sync, inside the tx
}
```

Three implementations, one contract test suite run against all of them:

- **`testing/memory-store.ts`** — a `Map` plus a counter. The reference
  implementation; every kernel test runs against it.
- **Desktop SQLite store** — Drizzle over the operations tables; `seq` is
  the rowid; `transaction` is the DB transaction shared with entity
  mutations (the outbox property from
  [01 §2](./01-concepts.md#2-the-two-planes)).
- **Host KV store** — the workspace server's JSON store behind its write
  lock; `transaction` serializes on that lock.

The contract tests (insert assigns monotonic seq; CAS transition rejects
wrong `from`; transactions are serialized; non-terminal listing is
consistent within a tx) are what make "same kernel, different stores" a
tested property instead of a hope.

## The registry

Definitions, handlers, and conflict policies reach the engine through a
registry assembled contributions-style — the same aggregation pattern as
browser contributions and task-tab providers, so features stay self-contained:

```ts
export interface OperationRegistry {
  definitions: readonly AnyOperationDefinition[];
  handlers: readonly AnyOperationHandler[];       // subset with local execution
  conflictPolicies: readonly ConflictPolicy[];    // merged; duplicate pairs are a startup error
}
```

Each feature slice exports its contribution
(`workspaces/operations/contribution.ts` with `teardownWorkspace`,
`provisionWorkspace`, their handlers where that plane executes them, and
`workspaceConflicts`); a per-plane manifest aggregates them. The engine
validates at construction: unique definition names, handlers matching known
definitions, no conflicting policy rows. Registration bugs are startup
errors, never runtime surprises.

## The engine

```ts
export function createOperationEngine(deps: {
  store: OperationStore;
  registry: OperationRegistry;
  progress: ProgressSink;
  clock?: Clock;                        // Date.now + timers; fake in tests
  /** Desktop only: gate dispatch on target-host availability (05 §per-plane). */
  hostAvailability?: HostAvailability;
}): OperationEngine;

export interface OperationEngine {
  submit<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>,
    opts: { initiator: OperationInitiator; parentId?: string }
  ): Promise<Result<OperationHandle<D>, AdmissionError>>;

  submitBatch(members: BatchMember[], opts: BatchOptions):
    Promise<Result<BatchHandles, AdmissionError>>;      // 04 §batch-admission

  cancel(id: string): Promise<void>;
  get(id: string): Promise<OperationRecord | undefined>;

  /** Boot sequence — must complete before the first submit. See §recovery. */
  recover(): Promise<void>;

  /** Dispose: stop dispatching, fire signals of running handlers, await settle. */
  shutdown(): Promise<void>;
}

export interface OperationHandle<D extends AnyOperationDefinition> {
  id: string;
  /** Resolves at terminal status. Never rejects — errors are values. */
  result: Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>>;
  /** Live stage stream; ends at settlement. */
  follow(cb: (progress: OperationProgress) => void, opts: { scope: Scope }): void;
  cancel(): Promise<void>;
}
```

`OperationFailure` distinguishes the terminal shapes:
`{ kind: 'rejected'; error: TError }` (typed, from `ctx.reject`) vs
`{ kind: 'failed'; error: OperationErrorSummary }` vs
`{ kind: 'cancelled' | 'superseded' }`. Call sites that care pattern-match;
call sites that don't check `.ok`.

`follow` takes a `Scope` (from `@emdash/shared/concurrency`), consistent
with the repo-wide ownership rule — no manual unsubscribe in the common
path.

### The internal loop

The engine is event-driven, not polling. One dispatch pass runs per poke;
pokes come from: `submit`/`submitBatch` commit, any settlement, retry
backoff timers elapsing, `recover()` completing, and (desktop)
host-availability changes. Between pokes the engine is idle — no timers
except pending backoffs.

Settlement is the busiest path and runs as one transaction: CAS the terminal
status, write `outcome`, then — outside the transaction — end the progress
stream, resolve the handle, settle `waiting-children` parents whose last
child just finished, and poke dispatch.

## Recovery

`recover()` runs once at boot, before any submission, as one transaction
plus a poke:

1. **Reset interrupted work**: every `running` record → `pending`,
   `attempt` preserved (a process death consumes no attempt). Handlers'
   idempotency (physical guards) makes the re-dispatch safe.
2. **Settle orphaned parents**: `waiting-children` records whose children
   are all terminal settle now (their settlement was lost in the crash).
3. **Expire stale intent** (desktop, policy-driven): pending records past a
   definition-declared TTL can be marked `failed` with an expiry error
   rather than surprising the user by executing days-old intent.
4. Poke dispatch; `RunningClaims` rebuilds itself as (nothing) — the running
   set is empty by step 1.

Nothing else is needed because nothing else is volatile: claims live on
records, dispatch state is recomputed per pass, progress is ephemeral by
design.

## Cross-plane composition

The kernel never talks to the network; the desktop-to-host bridge is an app
edge built *from* kernel pieces. The pattern
([08 §cross-plane](./08-usage-patterns.md#cross-plane-operations) has the
full worked example):

- The desktop definition's handler is a **bridge handler**: it submits the
  execution-plane definition to the target host's engine over wire, pipes
  the host's progress stream into the desktop's `ProgressSink` under the
  desktop operation id, and maps the host result onto its own return.
- Reconnection is the bridge's problem, solved with the existing
  submit-and-follow machinery: host operations are keyed, so re-submission
  after a connection drop dedupes into the still-running host record and
  re-attaches the follow.
- The desktop record is thereby a *true* record of the intent (durable,
  retryable, visible in history) while the host record is the truthful
  record of execution — the two-plane split of
  [01 §2](./01-concepts.md#2-the-two-planes) made mechanical.

## Testing

The kernel tests in four tiers, mirroring `wire/src/state/`:

1. **Pure-layer tests** — golden matrix cells and symmetry; expansion
   properties ([02 §testing](./02-resources-and-claims.md#testing-obligations));
   table-driven `admit` cases covering every verb, dedupe-by-key,
   default-reject, and batch member ordering; `dispatchPass` properties
   (no hold-and-wait, drain/progress, lanes-equivalence for exclusive-only
   workloads, starvation-freedom under adversarial scan streams).
2. **Store contract tests** — one suite, three implementations (§the store
   port).
3. **Engine tests** — memory store + fake clock: full lifecycles, retries
   with backoff timing, cancellation at each status, supersession of running
   work, parent/child settlement and adoption, recovery from every
   crash-point (kill between admission and dispatch, mid-handler, between
   settlement and parent update).
4. **Adapter tests** — desktop store over real SQLite (existing `main-db`
   Vitest project), host store over the KV harness, bridge handler over the
   wire test harness.

The scripted-handler harness (`testing/harness.ts`) makes tier 3 ergonomic:
handlers whose stages, failures, and durations are declared per test, plus
assertion helpers over records and progress streams.

## Migration

The order that keeps every commit shippable:

1. **Land the kernel** (pure layers + engine + memory store) with tiers 1–3
   green. Zero app integration; purely additive.
2. **Desktop adapter**: implement the SQLite store (schema gains `claims`
   and `outcome` columns via a generated Drizzle migration), swap the
   internals of the desktop operations service to `createOperationEngine`
   behind its existing wire surface, and migrate desktop definitions
   (project/task deletion trees) to `defineOperation`. All operations claim
   `mutates(...)` — lanes-equivalent behavior, no observable change.
3. **Host adapter**: implement the KV store, express host work
   (provision/teardown/prune/scan) as handlers with `ctx.stage` (the
   bootstrap-plan workflow maps step-per-stage), bridge progress onto wire
   live state, and replace the desktop's submit-and-follow internals with
   the bridge-handler pattern.
4. **Turn on the matrix**: scans become `reads(...)`; repo-wide prune and
   host drain become expressible; the `queue` verb enters the conflict
   table.
5. **Delete the superseded**: the old engine internals, the host log's
   bespoke record/status shapes, the stage-lifting adapters, and every
   per-feature exclusivity check.

Steps 1 and 4 are low-risk and pure-core; 2 and 3 are the high-risk ones
(database migration, host log format) and each warrants its own PR with the
kernel already proven against the memory store.
