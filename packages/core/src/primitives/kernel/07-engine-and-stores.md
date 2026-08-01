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

  listRecords(): Promise<OperationRecord[]>;
  listNonTerminal(): Promise<OperationRecord[]>;
  listPending(): Promise<OperationRecord[]>;      // dispatch candidates, seq order
  get(id: string): Promise<OperationRecord | undefined>;
  listByParent(parentId: string): Promise<OperationRecord[]>;
  listTransitions(operationId: string): Promise<OperationTransition[]>;  // the journal
}

export interface OperationStoreTx {
  insert(record: NewOperationRecord): OperationRecord;   // store assigns seq;
                                                          // writes operation_claims rows (02)

  /**
   * Compare-and-swap status transition. Returns false (and writes nothing)
   * if the record's current status ≠ from — the store-level enforcement of
   * the status machine. Takes a cause and journals the transition
   * automatically (see §the-transition-journal): a CAS and its journal row
   * are inseparable by construction, not by caller discipline.
   */
  transition(
    id: string,
    from: OperationStatus,
    to: OperationStatus,
    cause: TransitionCause,   // 'submit' | 'dispatch' | 'settle' | 'retry' |
                              // 'crash-reset' | 'shutdown' | 'cancel' | 'supersede' | ...
    patch?: Partial<Pick<OperationRecord,
      'attempt' | 'notBefore' | 'error' | 'outcome' | 'result' | 'rejectedError' | 'parentId'>>
  ): boolean;

  reparent(id: string, parentId: string): void;          // adoption; journals and bumps updatedAt
  listNonTerminal(): OperationRecord[];                   // sync, inside the tx

  /**
   * Targeted admission read over the relational claims table: every claim
   * held by a non-terminal operation on any of the given keys, joined with
   * the holder's record identity (id, name, key, status) so admission can
   * resolve verbs and build reject/supersede lists without hydrating the
   * full non-terminal set.
   */
  listNonTerminalClaimsOnKeys(keys: readonly string[]): ClaimWithHolder[];
}
```

### The transition journal

Every CAS appends a row to `operation_transitions(operationId, from, to,
at, cause)` in the same transaction. Insert also writes the timeline start
(`pending → pending`, cause `submit`), and adoption writes a same-status
`adoption` row while bumping `updatedAt`. This is the deliberately small
slice of event sourcing worth having: an **operation timeline** for display
and debugging ("pending 09:14 → running 09:15 → pending (retry 1) 09:17 → …")
and the natural poke source for read-model invalidation
([09](./09-querying-and-display.md)) — without adopting fold-derived state,
which is wrong for this system because the log records work *about* an
externally mutable world rather than being the source of truth itself.
Records stay the authority; the journal is history. It shares the records'
retention policy — pruning a terminal record prunes its transitions (FK
cascade).

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
transition rejects wrong `from`; transactions are serialized and roll back
on throw; nested transactions are rejected rather than deadlocking;
non-terminal listing is consistent within a tx; submit/adoption/CAS rows are
journaled) are what make "same kernel, different stores" a tested property
instead of a hope.

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

  /** Read path for display surfaces — filters and folds, see 09. */
  query(filter: OperationQueryFilter): Promise<OperationQueryPage>;

  /** Latest dispatch explanation for pending display: skipped + deferred. */
  lastDispatchReport(): DispatchPassReport;

  /** Boot sequence — must complete before the first submit. See §recovery. */
  recover(): Promise<void>;

  /**
   * Graceful stop, NOT cancellation: stop dispatching, fire running
   * handlers' signals with reason 'shutdown', reset interrupted records
   * running → pending (attempt preserved), resolve when settled. See
   * §shutdown.
   */
  shutdown(): Promise<void>;
}

export interface OperationHandle<D extends AnyOperationDefinition> {
  id: string;
  /** Resolves at terminal status. Never rejects — errors are values. */
  result: Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>>;
  /** Live stage stream; ends at settlement (06 §follow-semantics). */
  follow(cb: (progress: OperationProgress) => void, opts: { scope: Scope }): void;
  cancel(): Promise<void>;
}
```

`OperationFailure` distinguishes the terminal shapes:
`{ kind: 'rejected'; error: TError }` (typed, from `ctx.reject`) vs
`{ kind: 'failed'; error: OperationErrorSummary }` vs
`{ kind: 'cancelled' | 'superseded' }`. Call sites that care pattern-match;
call sites that don't check `.ok`.

`handle.result` works **across restarts**, not just for the submitting
process: because terminal payloads are persisted on the record
([03 §the-record](./03-operations.md#the-record)), a handle obtained after
reboot — via dedupe, `engine.get`, or a resuming `ctx.run` — reads the
stored payload and validates it through the definition's schemas. The
contract: the typed result is available *for as long as the definition's
current `result` schema still parses the persisted payload*; after an
incompatible app upgrade it degrades to status + the versioned `outcome`,
never to a crash.

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

## Lifecycle

### Recovery

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

### Shutdown

`shutdown()` is a **graceful stop, not a cancellation**. The distinction
matters because an intent ledger must not let quitting the app cancel a
teardown the user asked for:

1. Stop dispatching (no new starts), including any dispatch pass already
   queued in a microtask.
2. Fire every running handler's `AbortSignal` with reason `'shutdown'`
   ([06 §abort reasons](./06-execution-and-handlers.md#abort-reasons)).
3. Each interrupted record transitions `running → pending`, `attempt`
   preserved — identical to crash recovery, because that is what it is:
   a crash the process saw coming. The work resumes on next boot.
4. Resolve when all running handlers have settled.

`cancelled` is reserved for *chosen* cancellation; shutdown never produces
it. The race where a handler finishes its work just as the signal fires
resolves by CAS ordering: whichever transition lands first
(`running → succeeded` from settlement, or `running → pending` from
shutdown) wins, and the loser's CAS returns `false` and writes nothing.

### The single-writer invariant

**Exactly one engine instance runs per store.** The in-memory
`RunningClaims` set is authoritative for what is running, which is sound
only if no other process dispatches from the same store — two engines on
one SQLite file would each see the other's `running` rows as claims but
race each other's dispatch passes and double-start work. Today the
invariant holds structurally (one main process per app database, one
workspace-server process per host database). If a deployment shape ever
puts it at risk, the guard is a **store-level engine lease** (a heartbeat
row the engine must hold to dispatch) — named here so it gets built
deliberately, not improvised during an incident.

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

**The bridge re-entrancy invariant:** a bridge handler must be re-entrant
via **key-dedupe, never via recorded state**. When the desktop crashes
mid-bridge and the handler re-runs, it re-submits the host operation with
the same key and coalesces into whatever the host is already doing — it
never consults its own prior attempt's facts or progress to decide whether
to resubmit. This is the same rule as
[06 §facts-are-write-only](./06-execution-and-handlers.md#facts-are-write-only)
applied across the wire, and it is the entire reason the long-await bridge
is sound: the host's log, not the desktop's memory of it, is the authority
on what is running there.

## Non-goals

The kernel's consistency comes from what it refuses to be. Each refusal is
load-bearing; treat additions that reintroduce one as design regressions:

- **No deterministic replay.** Recovery re-runs code against reality
  (guards + key-dedupe); we never require handler code to be replayable,
  so ordinary nondeterministic code stays legal.
- **No step checkpointing.** A step worth persisting is a child operation;
  mid-handler checkpoints without replay semantics resume into states whose
  preconditions may no longer hold.
- **No event-sourced storage.** Records are current-state rows plus a
  transition journal for history; folding state from events is wrong for a
  log *about* an externally mutable world.
- **No cron.** `notBefore` schedules retries only; recurring work belongs
  to the app's automation layer, which *submits* operations.
- **No exactly-once external effects.** Impossible over git/fs/network;
  the kernel offers at-least-once with idempotent handlers instead of
  pretending otherwise.

## Testing

The kernel tests in four tiers, mirroring `wire/src/state/`:

1. **Pure-layer tests** — golden matrix cells and symmetry; expansion
   properties ([02 §testing](./02-resources-and-claims.md#testing-obligations));
   table-driven `admit` cases covering every verb, dedupe-by-key,
   default-reject, and batch member ordering; the **composite-admission
   precedence table** (dedupe short-circuits; any reject rejects all;
   supersede targets collect) and **dedupe-despite-differing-input** pinned
   as the winner's-input contract; **ancestor exemption** at admission
   (the project-deletion batch example as a literal test); **orphans-only
   adoption** (a parented match dedupes, never re-parents); `dispatchPass`
   properties (no hold-and-wait for queued work, drain/progress,
   lanes-equivalence for exclusive-only workloads, starvation-freedom under
   adversarial scan streams) plus **pass-report assertions** (a skipped
   operation's report names its blockers or barred keys) and **ancestor
   exemption at dispatch** (a running parent's claims never block its
   children).
2. **Store contract tests** — one suite, two implementations (§the store
   port), including `listNonTerminalClaimsOnKeys` targeting and the journal
   invariants: **one journal row per successful CAS, no journal row on a
   failed CAS**, cause recorded.
3. **Engine tests** — memory store + fake clock: full lifecycles, retries
   with backoff timing, cancellation at each status, **supersession of
   running work end to end** (abort with `'supersede'`, incumbent settles
   `superseded`, newcomer dispatches after), **claims-release-at-
   waiting-children** (children dispatch while the parent waits),
   **shutdown-resumes-after-restart** (interrupted work goes `pending`,
   survives reboot, completes; never `cancelled`), **cross-process typed
   result** (settle, rebuild the engine over the same store, `handle.result`
   returns the typed payload), parent/child settlement and adoption,
   recovery from every crash-point (kill between admission and dispatch,
   mid-handler, between settlement and parent update). Because shared modes
   ship day one, the shared-mode interleavings are first-class scenarios
   here, not follow-ups: scan×teardown (teardown queues behind running
   scans; a new scan is rejected by the pending teardown; the fairness
   barrier drains in `seq` order) and measure×provision (repo-level read
   waits for descendant mutations, blocks new ones, coexists with
   descendant reads). With `ctx.run` in scope: the **crash-resume
   orchestration test** (kill a coordinator between steps; on re-run the
   first child dedupes with its persisted result and the flow completes)
   and **cancellation cascading through an await**.
4. **Adapter tests** — the SQLite store over real SQLite in both
   constructions (desktop: joining an external transaction; server: owning
   its transactions — the existing `main-db` Vitest project hosts the
   former), and the bridge handler over the wire test harness.

The scripted-handler harness (`testing/harness.ts`) makes tier 3 ergonomic:
handlers whose stages, failures, and durations are declared per test, plus
assertion helpers over records and progress streams. `testing/` also ships
the **conflict-table completeness lint**: given every registered definition
and representative inputs (claim shapes are input-dependent), assert that
every pair of definitions whose claims can collide has an explicit policy
row — turning default-reject surprises in production into red CI.

## Migration

The order that keeps every commit shippable. Shared modes are not a
separate phase — the conflict table is authored with `queue` rows and the
read paths become operations as part of the adapter steps
([05 §day-one](./05-dispatch.md#shared-modes-are-day-one-not-a-later-phase)):

1. **Land the kernel** (pure layers + engine + memory store) with tiers 1–3
   green — including the shared-mode interleaving scenarios. Zero app
   integration; purely additive.
2. **Desktop adapter**: implement the SQLite store (schema gains the
   `operation_claims` and `operation_transitions` tables plus
   `outcome`/`result`/`rejectedError`/`notBefore` columns via a generated
   Drizzle migration), swap the
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
