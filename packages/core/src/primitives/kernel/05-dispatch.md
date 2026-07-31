# Dispatch

Dispatch is the second gate: *may this pending operation run now?* It is a
claim-compatibility check against the **running set**, using the same matrix
admission used against the non-terminal set. Where admission resolves
collisions with verbs (dedupe/reject/supersede/queue), dispatch has exactly
one response to incompatibility: wait. Waiting is free — a pending operation
holds durable claims but zero runtime resources.

Dispatch is what replaces today's per-host serial lanes, and it is a strict
generalization of them: when every operation claims a single `exclusive`
key, matrix-gated dispatch *is* `KeyedLanes`. The generalization buys two
things lanes cannot express — shared-mode concurrency (three scans of one
worktree run together) and hierarchical gating via intent modes (a repo-wide
prune waits for every worktree operation to drain without knowing the
worktrees exist).

## The algorithm

Two pieces of state, one pass function.

### `RunningClaims`

Held claims are tracked **per operation**, with an aggregate index derived
from the per-operation map — not as a bare multiset. Two consumers require
the operation-level granularity: claim release at `waiting-children`
(release *this parent's* claims, §below) and the ancestor exemption
(compatibility checks that skip *specific holders*). The aggregate still
behaves as a multiset — claims stack: two scans each hold `shared` on the
same worktree, and every worktree operation stacks an implicit intent on
the repo and host.

```ts
class RunningClaims {
  private byOperation = new Map<string, ResourceClaim[]>();          // opId → claims
  private held = new Map<string, Map<ClaimMode, Set<string>>>();     // key → mode → holder opIds

  /** Compatible with everything running, ignoring the given holders
   *  (the requesting operation's ancestor chain). */
  compatible(claims: ResourceClaim[], ignoring: ReadonlySet<string>): boolean {
    return claims.every((c) => {
      const modes = this.held.get(c.key);
      if (!modes) return true;
      for (const [heldMode, holders] of modes) {
        if (!modesCompatible(heldMode, c.mode) && holdersBeside(holders, ignoring)) {
          return false;
        }
      }
      return true;
    });
  }

  acquire(operationId: string, claims: ResourceClaim[]): void;
  release(operationId: string): void;   // waiting-children and settlement both use this
}
```

### `dispatchPass`

Runs on every poke — operation admitted, operation settled, host
reconnected. It returns a **pass report** rather than dispatching silently:
the report is what `waitingOn` and the tests read
([09](./09-querying-and-display.md) consumes it for derived scheduling
state).

```ts
export interface DispatchPassReport {
  started: string[];                                    // operation ids
  skipped: Array<{
    id: string;
    blockedBy: string[];                                // running holder ids (matrix)
    barredOn: string[];                                 // keys barred by older waiters
  }>;
}

export function dispatchPass(
  pending: readonly PendingOperation[],   // { id, seq, claims, ancestors: Set<id>, start() }
  running: RunningClaims,
  gate?: (op: PendingOperation) => boolean   // notBefore + adapter availability; a gated
                                             // skip plants no barriers (not contention)
): DispatchPassReport {
  // Fairness barriers: once an older operation is skipped, its keys bar
  // incompatible younger requests, so exclusive work cannot starve.
  const barred = new Map<string, ClaimMode[]>();
  const report: DispatchPassReport = { started: [], skipped: [] };

  for (const op of [...pending].sort((a, b) => a.seq - b.seq)) {
    if (gate && !gate(op)) continue;                    // ineligible, not contending
    const barredOn = op.claims
      .filter((c) => (barred.get(c.key) ?? []).some((m) => !modesCompatible(m, c.mode)))
      .map((c) => c.key);
    const blockedBy = running.blockers(op.claims, op.ancestors); // holder ids, exemption applied
    if (barredOn.length > 0 || blockedBy.length > 0) {
      for (const c of op.claims) {
        const modes = barred.get(c.key) ?? [];
        modes.push(c.mode);
        barred.set(c.key, modes);
      }
      report.skipped.push({ id: op.id, blockedBy, barredOn });
      continue;
    }
    running.acquire(op.id, op.claims);
    op.start(); // engine runs the handler; on settle: release(op.id) + re-poke
    report.started.push(op.id);
  }
  return report;
}
```

Complexity is O(pending × claims-per-operation) per pass — irrelevant at
emdash scale (a few operations, a handful of claims each).

### Fairness barriers — the non-obvious part

Without the `barred` set, an `exclusive` teardown waits behind a stream of
`shared` scans forever: each *new* scan is individually compatible with the
*running* scans, so it starts, and the teardown never finds a gap. Classic
writer starvation.

The barrier fixes it: the moment the teardown is skipped, its keys are
barred — younger operations requesting incompatible modes on those keys are
also skipped, this pass and every pass, until the teardown runs. The result
is a fair readers–writer lock generalized to arbitrary keys and modes:
**FIFO per contended key, full concurrency everywhere else.** Progress is
provable by induction on `seq`: the oldest waiting operation's blockers are
all running (finite) or younger (barred), so it eventually starts.

## Ancestor exemption and claim release

Two rules make coordinator trees dispatchable; both exist because without
them the docs' own canonical example deadlocks
([04 §ancestor exemption](./04-admission-and-conflicts.md#the-ancestor-exemption)):

- **Ancestor exemption at dispatch.** A pending operation's compatibility
  check ignores claims held by its own ancestor chain (`op.ancestors`,
  resolved by the engine from `parentId` links). A running project-delete
  parent's claims never block its own teardown children. Siblings are *not*
  exempt from each other.
- **Claim release at `waiting-children`.** When a parent's handler returns
  and the parent transitions `running → waiting-children`, the engine calls
  `running.release(parentId)`: its own work is done, so it stops occupying
  the running set — otherwise it would block work it is waiting for. The
  parent remains in the **non-terminal set for admission**, so external
  newcomers still see its intent and consult the policy table against it.

## Why queueing cannot deadlock — and where the proof stops

Deadlock needs hold-and-wait: holding one resource while blocking on
another. Dispatch never creates that condition for *queued* operations — an
operation acquires its *entire* claim set's right-to-run atomically at
start, or acquires nothing and keeps waiting while holding no runtime
resources. The Coffman conditions never assemble. This is precisely why the
`queue` admission verb (banned in earlier designs that contemplated
lock-style wait queues) became safe to offer.

The proof obligation ships as a property test: a waiting operation's
runtime footprint is empty, and any finite set of admitted operations fully
drains.

**The proof's domain ends at awaiting parents.** An imperative coordinator
blocked in `ctx.run`
([06](./06-execution-and-handlers.md#ctxrun-and-ctxspawn-operations-from-inside-handlers))
is still `running` and still holds its claims while waiting on its children
— genuine hold-and-wait, reintroduced deliberately. The ancestor exemption
makes parent-child cycles impossible, but *cross-tree* cycles become
constructible: two awaiting parents whose claims each block the other's
subtree. The v1 posture is discipline, not machinery: **awaiting
coordinators claim only what their subtree exclusively owns** — typically
the desktop entity being coordinated, never broad host resources
([08 §anti-patterns](./08-usage-patterns.md#anti-patterns)). Wait-for-graph
cycle detection over `RunningClaims` + `blockedBy` is the named future
backstop if the discipline ever proves insufficient; it is not built until
a real cycle is seen. Do not quote the no-hold-and-wait proof outside its
domain.

## A worked example

Running: two scans holding `shared worktree:A` (each stacking
`intent-shared repo:P`), one teardown holding `exclusive worktree:B` +
`intent-exclusive repo:P`.

Pending, in `seq` order:
① teardown of A (`exclusive worktree:A`, `intent-exclusive repo:P`),
② repo-wide prune (`exclusive repo:P`),
③ new scan of A (`shared worktree:A`).

The pass: ① conflicts (`exclusive` vs running `shared` on `worktree:A`) →
waits, bars `worktree:A`. ② conflicts (`exclusive repo:P` vs running
intents) → waits, bars `repo:P`. ③ is mode-compatible with the *running*
scans — but `worktree:A` is barred by ① with an incompatible mode → waits.

Scans finish → ① runs. ① and the teardown of B finish → `repo:P` drains of
intents → ② runs, alone on the whole repo. ③ runs after ②.

Every ordering decision came from two constants — the matrix and `seq` —
with zero per-case code. Note ② especially: repo-wide work excluded *all*
worktree activity without enumerating a single worktree.

## The derived waiting state

A queued-behind operation's stored status is `pending` — there is no
`waiting-for-resource` status ([03 §statuses](./03-operations.md#statuses)).
The UI derives the explanation from the **pass report**, which is why the
report exists: it covers *both* reasons an operation didn't start — matrix
blockers (`blockedBy`, with the holding operation ids for display labels)
and fairness barriers (`barredOn`). Deriving from claims alone would show a
barrier-blocked operation as "waiting on nothing".

```ts
// "Waiting for 2 operations on feat-x" — derived from the latest pass
// report, never stored.
export function waitingOn(
  opId: string,
  report: DispatchPassReport
): { blockedBy: string[]; barredOn: string[] } | undefined;
```

Derived-not-stored is what keeps cancellation trivial (§below) and avoids a
whole class of stale-status bugs: the moment the blocker settles, the next
pass's report simply no longer lists the operation as skipped. The report
also gives tests direct assertions on *why* something didn't start, instead
of inferring it from absence.

## Cancellation and supersession while waiting

Trivial by construction: a waiting operation holds nothing at runtime, so
cancelling it is a status transition (`pending → cancelled`) and nothing
else. Its fairness barriers evaporate on the next pass because they are
recomputed per pass, never stored. Superseding a waiting incumbent is the
same transition with a different terminal status.

## Restart

Nothing about dispatch persists. On boot,
[recovery](./07-engine-and-stores.md#recovery) resets `running → pending`
(with `attempt` preserved), `RunningClaims` starts empty, and the first pass
re-dispatches in `seq` order. Operations interrupted mid-flight rely on
their handlers' idempotency (physical guards, probing) — which they need
anyway, per [01 §4](./01-concepts.md#4-claims-are-advisory-handlers-hold-the-guard).

## Per-plane gating

Each plane dispatches against its own running set:

- The **desktop** dispatcher additionally gates on host *availability*: an
  operation whose work targets an offline host is skipped (without barring —
  offline is not contention) and re-poked when the host connects.
- The **host** dispatcher gates purely on claims; by the time work reaches
  the host log, the desktop has already sequenced intent.

Since desktop claims describe desktop-visible intent and the host is the
physical truth, host-side handler guards remain the final arbiter regardless
of what either dispatcher decided.

## Capacity limits

Claims answer *correctness* — which operations may overlap. They do not
answer *load*: fifty shared-mode scans of fifty different worktrees are
mutually compatible and would all start in one pass, storming the host with
fifty concurrent `git status` processes. Capacity is a separate, explicit
gate at dispatch:

```ts
export interface DispatchLimits {
  /** Max running operations whose explicit claims are all shared (the
   *  read class). Mutations are never capacity-limited — they are few,
   *  user-initiated, and already serialized by claims. */
  maxConcurrentReads?: number;

  /** Same cap, grouped per host so one busy host cannot starve others.
   *  hostOf extracts the grouping key from the operation's claims. */
  maxConcurrentReadsPerHost?: number;
  hostOf?: (op: PendingOperation) => string | undefined;
}
```

The rules that keep this from corrupting the fairness story:

- **Class is derived from explicit claim modes**, not declared per
  definition: an operation whose explicit (non-implicit) claims are all
  `shared` is in the read class; anything holding an explicit `exclusive`
  is not. Deriving it keeps definitions honest — you cannot claim
  exclusively and dodge into the read lane.
- **A capacity skip plants no fairness barriers.** Barriers exist for
  *contention* (an older operation blocked by incompatible modes); a
  capacity skip is the system saying "not yet, too busy", and barring its
  keys would freeze unrelated work behind a full read lane. Same treatment
  as the availability gate above.
- **FIFO within the class by `seq`** — capacity admits the oldest eligible
  reads first, so a burst cannot starve an earlier read.

Capacity here is the middle layer of a three-layer throttling story:
wire-level demand gating decides *whether* a read is wanted at all
([09](./09-querying-and-display.md#reactive-queries-fetch-through-operations)),
dispatch capacity bounds *how many* run system-wide, and handler-internal
fan-out bounds parallelism *inside* one operation
([06 §concurrency](./06-execution-and-handlers.md#concurrency-inside-vs-across-operations)).
None of the three substitutes for another.

## Shared modes are day-one, not a later phase

Earlier drafts staged the rollout — ship exclusive-only (lanes-equivalent)
first, turn on shared modes later. That staging is dropped: the dispatcher
is the same ~60 lines either way, and the shared-mode semantics are where
the real wins live (the scan×teardown race class, deduped reads, consistent
subtree snapshots — see
[08 §observational](./08-usage-patterns.md#the-observational-operation)).
Deferring them would mean migrating the read paths twice.

What survives from the staging idea is the **test**, demoted from rollout
gate to permanent sanity check: for exclusive-only workloads, `dispatchPass`
and a reference `KeyedLanes` implementation must produce identical start
orders. This pins down the degenerate case (matrix-gated dispatch *is*
lanes when every claim is `exclusive`) so the generalization can never
regress the simple workloads.

The cost of leaning in is carried by the test suite, not the code: the
interesting interleavings from day one are scan×teardown and
measure×provision, and the engine tests must cover them explicitly
([07 §testing](./07-engine-and-stores.md#testing)).
