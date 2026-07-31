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

Two implementations, one contract test suite run against both:

- **`testing/memory-store.ts`** — a `Map` plus a counter. The reference
  implementation; every kernel test runs against it.
- **`SqliteOperationStore`** — one implementation, built on the existing
  `core/src/primitives/sqlite-store/` primitive, used by **both planes**.
  There is no separate host KV store: the workspace server runtime can take
  the same SQLite dependency, and a second persistence format would buy
  nothing but a second set of bugs.

The two planes construct the SQLite store differently, and that difference
lives in adapter construction, not in the port:

- The **desktop** store attaches to the app database and must accept an
  *external* transaction handle — admission joins the caller's Drizzle
  transaction so the entity mutation and the operation land atomically (the
  outbox property from [01 §2](./01-concepts.md#the-desktop-ledgers-dual-role)).
- The **workspace server** store owns its own database file and its own
  transactions.

The port itself is justified by purity and testability, not by backend
plurality — it is what lets every engine test run against memory with a
fake clock. The contract tests (insert assigns monotonic seq; CAS
transition rejects wrong `from`; transactions are serialized; non-terminal
listing is consistent within a tx) are what make "same kernel, different
stores" a tested property instead of a hope.

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
2. **Store contract tests** — one suite, two implementations (§the store
   port).
3. **Engine tests** — memory store + fake clock: full lifecycles, retries
   with backoff timing, cancellation at each status, supersession of running
   work, parent/child settlement and adoption, recovery from every
   crash-point (kill between admission and dispatch, mid-handler, between
   settlement and parent update). Because shared modes ship day one, the
   shared-mode interleavings are first-class scenarios here, not follow-ups:
   scan×teardown (teardown queues behind running scans; a new scan is
   rejected by the pending teardown; the fairness barrier drains in `seq`
   order) and measure×provision (repo-level read waits for descendant
   mutations, blocks new ones, coexists with descendant reads).
4. **Adapter tests** — the SQLite store over real SQLite in both
   constructions (desktop: joining an external transaction; server: owning
   its transactions — the existing `main-db` Vitest project hosts the
   former), and the bridge handler over the wire test harness.

The scripted-handler harness (`testing/harness.ts`) makes tier 3 ergonomic:
handlers whose stages, failures, and durations are declared per test, plus
assertion helpers over records and progress streams.

## Migration

The order that keeps every commit shippable. Shared modes are not a
separate phase — the conflict table is authored with `queue` rows and the
read paths become operations as part of the adapter steps
([05 §day-one](./05-dispatch.md#shared-modes-are-day-one-not-a-later-phase)):

1. **Land the kernel** (pure layers + engine + memory store) with tiers 1–3
   green — including the shared-mode interleaving scenarios. Zero app
   integration; purely additive.
2. **Desktop adapter**: implement the SQLite store (schema gains `claims`
   and `outcome` columns via a generated Drizzle migration), swap the
   internals of the desktop operations service to `createOperationEngine`
   behind its existing wire surface, and migrate desktop definitions
   (project/task deletion trees) to `defineOperation`. The conflict table
   ships complete from the start — `queue`, `supersede`, and `reject` rows
   included.
3. **Host adapter**: construct the same SQLite store for the workspace
   server, express host work as handlers with `ctx.stage` — the destructive
   paths (provision/teardown/prune, with the bootstrap-plan workflow mapping
   step-per-stage) *and* the read paths (git-stats scans, worktree probes,
   disk measures as `reads(...)` operations) — bridge progress onto wire
   live state, and replace the desktop's submit-and-follow internals with
   the bridge-handler pattern. This is deliberately the largest step: the
   read paths are where the shared-mode wins live
   ([08 §observational](./08-usage-patterns.md#the-observational-operation)),
   and migrating them later would mean touching every read path twice.
4. **Delete the superseded**: the old engine internals, the host log's
   bespoke record/status shapes, the stage-lifting adapters, the scan
   cache's in-flight dedupe, and every per-feature exclusivity check. The
   migration is not done until this list is empty — two coexisting systems
   indefinitely is the failure mode.

Step 1 is low-risk and pure-core; 2 and 3 are the high-risk ones (database
migration, host runtime storage) and each warrants its own PR with the
kernel already proven against the memory store. Validation gate between 2
and 3: the first migrated vertical slice (teardown end to end) must come
out visibly simpler than what it replaced — if it does not, stop and
reassess with one slice's sunk cost, not ten.
