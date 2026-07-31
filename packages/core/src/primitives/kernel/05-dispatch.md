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

A multiset of `(key, mode)` counts for everything currently running. A
multiset because claims stack: two scans each hold `shared` on the same
worktree, and every worktree operation stacks an implicit intent on the repo
and host.

```ts
class RunningClaims {
  private held = new Map<string, Map<ClaimMode, number>>(); // key → mode → count

  compatible(claims: ResourceClaim[]): boolean {
    return claims.every((c) => {
      const modes = this.held.get(c.key);
      if (!modes) return true;
      for (const [heldMode, count] of modes) {
        if (count > 0 && !modesCompatible(heldMode, c.mode)) return false;
      }
      return true;
    });
  }

  acquire(claims: ResourceClaim[]): void; // increment counts
  release(claims: ResourceClaim[]): void; // decrement, delete at zero
}
```

### `dispatchPass`

Runs on every poke — operation admitted, operation settled, host reconnected:

```ts
export function dispatchPass(
  pending: readonly PendingOperation[], // { seq, claims, start() }
  running: RunningClaims
): void {
  // Fairness barriers: once an older operation is skipped, its keys bar
  // incompatible younger requests, so exclusive work cannot starve.
  const barred = new Map<string, ClaimMode[]>();

  for (const op of [...pending].sort((a, b) => a.seq - b.seq)) {
    const blockedByBarrier = op.claims.some((c) =>
      (barred.get(c.key) ?? []).some((m) => !modesCompatible(m, c.mode))
    );
    if (blockedByBarrier || !running.compatible(op.claims)) {
      for (const c of op.claims) {
        const modes = barred.get(c.key) ?? [];
        modes.push(c.mode);
        barred.set(c.key, modes);
      }
      continue;
    }
    running.acquire(op.claims);
    op.start(); // engine runs the handler; on settle: release(claims) + re-poke
  }
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

## Why queueing cannot deadlock

Deadlock needs hold-and-wait: holding one resource while blocking on
another. Dispatch never creates that condition — an operation acquires its
*entire* claim set's right-to-run atomically at start, or acquires nothing
and keeps waiting while holding no runtime resources. The Coffman conditions
never assemble. This is precisely why the `queue` admission verb (banned in
earlier designs that contemplated lock-style wait queues) became safe to
offer.

The proof obligation ships as a property test: a waiting operation's
runtime footprint is empty, and any finite set of admitted operations fully
drains.

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
The UI derives the explanation on demand by intersecting the pending
operation's claims with `RunningClaims`:

```ts
// "Waiting for 2 operations on feat-x" — derived, never stored.
export function waitingOn(op: PendingOperation, running: RunningClaims): BlockingClaim[];
```

Derived-not-stored is what keeps cancellation trivial (§below) and avoids a
whole class of stale-status bugs: the moment the blocker settles, the
explanation is simply no longer derivable.

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
