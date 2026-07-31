# Admission and conflicts

Admission is the first gate: *may this intent exist in the log at all?* It
runs inside the log owner's transaction, compares the incoming operation's
claims against every non-terminal record using the compatibility matrix, and
resolves collisions with a verb from the central conflict policy. Because
admission is a pure function, the desktop's SQLite transaction and the
host's KV transaction wrap the *same* decision logic.

## The two-step decision

For each non-terminal record, admission asks two questions in order:

1. **Same work?** — `incoming.key === existing.key` → `dedupe`,
   unconditionally. The caller gets a handle to the existing operation; no
   policy consultation, no second row. This is what makes double-clicks,
   retried RPCs, and re-submitted automations free.
2. **Colliding work?** — do any of the two records' claims share a `key`
   with incompatible modes (`modesCompatible(existing.mode, incoming.mode)
   === false`)? Only then is the policy table consulted for a verb.
   Matrix-compatible pairs — two scans (`shared`+`shared`), a worktree
   teardown and an unrelated worktree's provision (`intent-exclusive`+
   `intent-exclusive` on the shared repo) — **never reach the table**; they
   coexist by construction.

This ordering is why the policy table stays small: it only describes what to
do about *genuine* contention, not about every pair of operation kinds.

## The policy table

```ts
export type ConflictResolution = 'dedupe' | 'reject' | 'supersede' | 'queue';

export const workspaceConflicts = defineConflictPolicy((on) => {
  // incoming            existing (non-terminal)
  on(teardownWorkspace,  provisionWorkspace).supersede();
  on(teardownWorkspace,  scanWorkspace).queue();       // run after scans drain
  on(provisionWorkspace, teardownWorkspace).reject();  // can't provision what's dying
  on(pruneRepoWorktrees, teardownWorkspace).queue();   // prune waits for teardowns
  on(teardownWorkspace,  pruneRepoWorktrees).queue();  // and vice versa
});
```

Design points, each settled deliberately:

- **Typed over definition objects, not strings.** `on(a, b)` takes the
  `OperationDefinition` values. Renames are refactor-safe, typos are compile
  errors, and "find all conflicts involving teardown" is find-references, not
  grep.
- **Directional.** `on(incoming, existing)` — the pair
  `(teardown, provision)` and `(provision, teardown)` are different rows,
  because the right verb usually differs (newer destruction supersedes older
  creation; newer creation is rejected by pending destruction).
- **Central, not per-definition.** One module per domain
  (`workspace-conflicts.ts`) aggregated through the contributions manifest.
  This resolves the circular-import problem (definitions never import each
  other) and makes the whole contention story reviewable in one place.
- **Default is `reject`.** An incompatible pair with no table entry is
  refused with a `conflict` error naming both operations. The safe default
  forces the table to be written consciously; a missing row is a loud bug,
  not silent queueing.

### The verbs

| Verb | Meaning | Typical use |
|---|---|---|
| `dedupe` | Return the existing operation's handle; insert nothing | Same-key submissions (automatic); rarely written explicitly |
| `reject` | Refuse admission with a typed conflict error | Work that is senseless given the incumbent (provision during teardown) |
| `supersede` | Mark the incumbent `superseded` (terminal), insert the newcomer | Newer intent invalidates older (teardown over pending provision); GitHub Actions' `cancel-in-progress` |
| `queue` | Insert the newcomer; [dispatch](./05-dispatch.md) orders it behind the incumbent | Sequenceable work (teardown after scans; prune after teardowns) |

Two caveats on the sharper verbs:

- **`supersede` of a `running` incumbent** is a cancellation request, not an
  instant replacement: the incumbent gets its `AbortSignal` fired and the
  newcomer stays `pending` until the incumbent actually reaches a terminal
  state. Claims outlive the supersede verb by exactly as long as the work
  does.
- **`queue` is safe from deadlock** by construction — a queued operation
  holds durable claims but no runtime resources, and dispatch acquires
  atomically (no hold-and-wait, see [05](./05-dispatch.md#why-queueing-cannot-deadlock)).
  What `queue` costs is a user-visible waiting state, which must be *derived*
  for display, never stored.

## `admit`

The pure function both planes call inside their transaction:

```ts
export function admit(
  incoming: {
    definition: AnyOperationDefinition;
    key: string;
    claims: ResourceClaim[];
  },
  nonTerminal: readonly OperationRecord[],
  policy: ConflictPolicy
): AdmissionDecision;

export type AdmissionDecision =
  | { kind: 'insert' }                                   // no collision
  | { kind: 'insert-queued' }                            // collision, verb=queue
  | { kind: 'dedupe'; existing: OperationRecord }
  | { kind: 'reject'; conflicts: OperationRecord[] }
  | { kind: 'supersede'; toSupersede: OperationRecord[] };
```

The engine's submit path is then mechanical:

```ts
await store.transaction((tx) => {
  const decision = admit(incoming, tx.listNonTerminal(), policy);
  switch (decision.kind) {
    case 'dedupe':    return handleFor(decision.existing);
    case 'reject':    return err(conflictError(decision.conflicts));
    case 'supersede': tx.markSuperseded(decision.toSupersede.map((r) => r.id)); // falls through
    case 'insert':
    case 'insert-queued':
      return handleFor(tx.insert(newRecord(incoming)));
  }
});
```

Everything decision-shaped is in `admit` (pure, exhaustively unit-tested);
everything effect-shaped is in the transaction (four lines per verb).

Because admission runs against the store's serialized non-terminal set, two
racing submissions cannot both pass: the second transaction sees the first's
row. This is the *only* concurrency control admission needs — no locks
beyond the store's own transactionality.

## Batch admission

The one place true all-or-nothing semantics exist. Deleting a project must
admit the project-delete parent *and* every workspace-teardown child
atomically — if any single admission rejects, none of them land:

```ts
engine.submitBatch([
  { definition: deleteProject, input: projectInput },
  { definition: teardownWorkspace, input: wt1, parent: 0 },  // index into batch
  { definition: teardownWorkspace, input: wt2, parent: 0 },
], { initiator: { kind: 'user', action: 'delete-project' } });
```

The batch runs as one store transaction; each member's `admit` sees the
non-terminal set *plus the batch members admitted before it*. A `reject` on
any member aborts the transaction (this is the behavior the current engine's
`RelatedOperationInsertError` provides — the kernel makes it a first-class
API instead of an exception convention).

Beyond admission, there are no operation transactions: execution-time
atomicity across irreversible external effects is a fiction the kernel
refuses to sell. See [08 §compensation](./08-usage-patterns.md#compensation).

## Adoption

The batch/tree variant of dedupe: a coordinator being admitted may find
*existing* non-terminal operations that are exactly the children it would
create (a project delete finding last week's still-failed workspace
teardown). Instead of `dedupe` (wrong — the parent is new work) or `reject`
(wrong — nothing conflicts), the parent **adopts**: admission re-parents the
matching orphan (`parentId := parent.id`) and skips inserting a duplicate
child. Match criterion is the child's `key` — the same identity dedupe uses.

Adoption is requested by the coordinator's submission
(`adoptExisting: true` on batch members), not implicit, because re-parenting
someone else's operation is a visible semantic change that should be
greppable at the call site.

## Where admission runs, per plane

- **Desktop ledger**: inside the same SQLite transaction as the entity
  mutation that motivates the operation — task row deleted and teardown
  admitted atomically (the transactional-outbox property). Non-terminal set
  is the ledger's non-terminal rows for the target host plus desktop-scoped
  rows.
- **Host log**: inside the host log's write lock, when the desktop submits
  the execution-plane counterpart (or when the host's own reconciler proposes
  work). The host's non-terminal set is its own log only — planes never
  admit against each other's records; the desktop's decision gates what gets
  *sent*, the host's decision gates what gets *run*, and each is
  authoritative for its own log.
