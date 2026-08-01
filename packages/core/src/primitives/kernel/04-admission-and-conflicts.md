# Admission and conflicts

Admission is the first gate: *may this intent exist in the log at all?* It
runs inside the log owner's transaction, compares the incoming operation's
claims against every non-terminal record using the compatibility matrix, and
resolves collisions with a verb from the central conflict policy. Because
admission is a pure function, the desktop's SQLite transaction and the
host's KV transaction wrap the *same* decision logic.

## The two-step decision

For each non-terminal record, admission asks two questions in order:

1. **Same work?** — `incoming.key === existing.key` and
   `incoming.definition.name === existing.name` → `dedupe`. A key match
   across different operation definitions is rejected, because the existing
   handle's result/error schemas would be the wrong type. For same-definition
   matches the caller gets a handle to the existing operation; no policy
   consultation, no second row. This is what makes double-clicks, retried
   RPCs, and re-submitted automations free.
2. **Colliding work?** — do any of the two records' claims share the same
   `(resource, key)` pair with incompatible modes
   (`modesCompatible(existing.mode, incoming.mode) === false`)? Only then is
   the policy table consulted for a verb.
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
  on(teardownWorkspace,  scanWorkspace).queue();       // destruction drains in-flight reads
  on(scanWorkspace,      teardownWorkspace).reject();  // scanning a dying path is senseless
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
  creation; newer creation is rejected by pending destruction). The scan
  pair shows the same asymmetry: a teardown arriving over running scans
  *queues* (let reads finish, then destroy), while a scan arriving over a
  pending teardown is *rejected* (reading a dying path is pointless — the UI
  renders "being removed" instead of a git error from a half-deleted
  directory).
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
  instant replacement: the incumbent's `AbortSignal` fires with reason
  `'supersede'` ([06 §abort reasons](./06-execution-and-handlers.md#abort-reasons)),
  it settles as `superseded`, and the newcomer stays `pending` until then.
  How the newcomer waits needs **no bespoke mechanism**: the aborting
  incumbent is still non-terminal, so its claims block the newcomer at
  dispatch through ordinary claim compatibility — there is no "waiting on
  supersede" state, and none should be built. Claims outlive the supersede
  verb by exactly as long as the work does. (A *pending* incumbent
  supersedes instantly: `pending → superseded`, nothing to abort.)
- **`queue` is safe from deadlock** by construction — a queued operation
  holds durable claims but no runtime resources, and dispatch acquires
  atomically (no hold-and-wait, see
  [05](./05-dispatch.md#why-queueing-cannot-deadlock--and-where-the-proof-stops)).
  What `queue` costs is a user-visible waiting state, which must be *derived*
  for display, never stored.

## The ancestor exemption

Operations are **never conflict-checked against their own ancestor chain** —
at admission or at dispatch ([05](./05-dispatch.md#ancestor-exemption-and-claim-release)).
Exempt pairs are filtered out *before* verb resolution, so the policy table
is never consulted for a parent-child pair.

Without this rule the docs' own canonical example fails: a project-delete
parent's claims collide with its teardown children's implicit repo intents,
the table has no `(teardownWorkspace, deleteProject)` row, and default-
reject aborts the batch. With it, a coordinator may claim what its subtree
works on and the subtree still admits and dispatches.

The exemption covers all three ways a parent relationship arises: intra-
batch (via the member's `parent` index), post-hoc (via stored `parentId`
chains, walked to the root), and adoption. It is strictly *ancestral* —
siblings are **not** exempt from each other, which is what keeps two
teardown children of one project delete from racing the same worktree if a
key bug ever produced overlapping claims.

## `admit`

The pure function both planes call inside their transaction. It operates on
*hydrated* records (claims joined in, per
[02](./02-resources-and-claims.md#claims-are-data)) — the relational claims
table changes how the store narrows what gets hydrated
([07 §store port](./07-engine-and-stores.md#the-store-port)), never this
signature. No store handle reaches the pure layer.

```ts
export function admit(
  incoming: {
    definition: AnyOperationDefinition;
    key: string;
    claims: ResourceClaim[];
    parentId?: string;          // for the ancestor exemption
  },
  nonTerminal: readonly OperationRecord[],
  policy: ConflictPolicy,
  byId: (id: string) => OperationRecord | undefined   // ancestor-chain resolver
): AdmissionDecision;

export type AdmissionDecision =
  | { kind: 'dedupe'; existing: OperationRecord }
  | { kind: 'reject'; conflicts: OperationRecord[] }
  | { kind: 'insert'; toSupersede: OperationRecord[] };  // queue pairs contribute
                                                          // nothing — queued-ness is
                                                          // derivable at dispatch
```

The decision is **composite** because one incoming operation can collide
with several non-terminal records under *different* verbs — a teardown
arriving over a pending provision (`supersede`) *and* two running scans
(`queue`) needs all outcomes at once. Precedence, as a documented and
tested property:

1. A same-definition key match short-circuits to `dedupe`; a cross-definition
   key match rejects — no policy consultation either way.
2. Ancestor-exempt pairs are filtered out.
3. If *any* remaining colliding pair resolves to `reject`, the whole
   admission is `reject` (listing every conflicting record).
4. Otherwise all `supersede` targets collect into one `insert`; `queue`
   pairs require nothing beyond insertion. There is no `insert-queued`
   kind — whether an inserted operation must wait is dispatch's question.

The engine's submit path is then mechanical:

```ts
await store.transaction((tx) => {
  const decision = admit(incoming, tx.listNonTerminal(), policy, byId(tx));
  switch (decision.kind) {
    case 'dedupe': return handleFor(decision.existing);
    case 'reject': return err(conflictError(decision.conflicts));
    case 'insert':
      supersede(tx, decision.toSupersede);   // pending → superseded now;
                                             // running → abort with 'supersede'
      return handleFor(tx.insert(newRecord(incoming)));
  }
});
```

Everything decision-shaped is in `admit` (pure, exhaustively unit-tested);
everything effect-shaped is in the transaction (a few lines per verb).

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

Parent references are intentionally one-way: a member may parent to an
earlier batch index only. Forward references are programmer errors because
they would otherwise insert silent roots or write `parentId: batch:N`
placeholder ids. If a later member dedupes into an earlier in-batch member,
the engine resolves that placeholder index to the earlier member's real
record id before returning handles or writing child `parentId`s.

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

Adoption re-parents **orphans only** (`parentId === null`). A matching
record that already belongs to another tree is never stolen — silently
re-parenting it would corrupt that tree's propagation and settlement. Such
a record matches by key, so the batch member dedupes into it *without*
re-parenting, and the coordinator's propagation policy simply doesn't cover
it.

Adoption is requested by the coordinator's submission
(`adoptExisting: true` on batch members), not implicit, because re-parenting
someone else's operation is a visible semantic change that should be
greppable at the call site.

Planned adoptions participate in the ancestor exemption during the same
batch. A parent being admitted is allowed to collide with an orphan child
that a later batch member explicitly adopts into that parent's subtree; the
collision is filtered before default-reject would see it. This is what makes
the canonical "delete project and adopt already-pending teardown children"
batch admit atomically.

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
