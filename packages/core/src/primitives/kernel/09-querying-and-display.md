# Querying and display

The read path. Everything before this document is the *write* side —
admission, dispatch, execution mutate records under CAS and transactions.
Display surfaces never touch that machinery: they consume **projections**,
pure folds over data the write side already produces. This is CQRS without
event sourcing: commands go through one narrow, guarded write model;
queries go through read-shaped views that can change freely because nothing
behavioral depends on them.

The rule that keeps the split honest: **a display need never adds a write.**
If the UI wants to show something the read side cannot derive, the answer
is a new fold or a new query filter — never a new status, a new stored
snapshot, or a hook into dispatch
([08 §anti-patterns](./08-usage-patterns.md#anti-patterns), "stored derived
state").

## The read sources

Four sources, joined on operation id, each already justified by the write
side's own needs:

1. **Records + the transition journal** (durable). The record answers "what
   is this and where did it end up"; the journal
   ([07 §journal](./07-engine-and-stores.md#the-transition-journal)) answers
   "how did it get there" — the timeline view (`pending 09:14 → running
   09:15 → pending (retry 1) 09:17 → succeeded 09:19`) is a straight read
   of journal rows. The relational claims table
   ([02](./02-resources-and-claims.md#claims-are-data)) is what makes
   resource-centric filters indexed lookups.
2. **Live progress** (ephemeral). The per-operation `OperationProgress`
   stream renders the stage checklist
   ([06 §stages](./06-execution-and-handlers.md#stages-and-progress));
   after settlement the durable `outcome` summary takes over.
3. **Derived scheduling state** (per-pass). The latest `DispatchPassReport`
   ([05](./05-dispatch.md#the-derived-waiting-state)) explains *why* a
   pending operation isn't running — blockers by holder id, barred keys —
   and is re-derived every pass, so it can never go stale.
4. **Entity tables** (app-owned). Labels and navigation targets — task
   names, project names, workspace paths — come from the app's own tables,
   joined by the resource keys in claims. The kernel stores keys, never
   display names.

## `engine.query()`

The one read entry point over durable state:

```ts
export interface OperationQueryFilter {
  /** All operations holding a claim on this key, or under this key prefix
   *  (subtree — 'worktree:host-1:/repos/acme/…'). Uses the claims table. */
  resource?: { key: string; subtree?: boolean };

  name?: string | string[];          // definition names
  active?: boolean;                  // non-terminal only
  settledAfter?: number;             // recent-history windows
  parentId?: string | null;          // children of; null = roots only
  initiatorKind?: OperationInitiator['kind'];

  /** Pagination: seq is the store's total order. */
  after?: { seq: number };
  limit?: number;
}

export interface OperationQueryPage {
  records: OperationRecord[];        // claims hydrated, seq order
  nextCursor?: { seq: number };
}
```

`query` is deliberately filter-shaped, not SQL-shaped: the store translates
filters into indexed reads (the claims table for `resource`, the status
column for `active`), and the memory store implements the same semantics
with array scans — one contract test suite covers both. Anything richer
(grouping, joins with entity tables) belongs in app-side read code on top
of the page this returns.

## The pure folds

The kernel owns the folds every consumer would otherwise hand-build —
they absorb what the app wrote by hand as `workspaceOperationPanelRecords`,
`operationChecklistByPath`, `shouldReplaceChecklistRecord`, and the
operation-tree rollup logic:

```ts
/** One user-facing status from record + latest pass report:
 *  'queued' | 'waiting' (with blockers) | 'running' | 'waiting-children' |
 *  terminal — the truthful-display mapping, computed in exactly one place. */
export function displayStatus(record: OperationRecord, report?: DispatchPassReport): DisplayStatus;

/** Recency-windowed, severity-ranked feed for panels: active operations
 *  first, then recently settled within the window, failures pinned. */
export function activityFeed(
  records: readonly OperationRecord[],
  opts: { now: number; recentWindowMs: number }
): OperationRecord[];

/** parentId links → display tree with severity roll-up per subtree
 *  (the existing operation-tree.ts logic, relocated to its data). */
export function operationTreeView(records: readonly OperationRecord[]): OperationTreeNode[];

/** Walk parentId to the root initiator: the "Tearing down feat-x — part of
 *  deleting project Acme" chain ([03 §initiators](./03-operations.md#initiators-every-operation-knows-why-it-exists)). */
export function provenanceChain(
  record: OperationRecord,
  byId: (id: string) => OperationRecord | undefined
): OperationInitiator[];
```

All four are pure over plain records (plus the pass report where noted):
unit-testable with literals, no store, no engine. App code composes them —
"the workspace panel" is `query({ resource: { key: repoKey, subtree: true } })`
piped through `activityFeed`, with labels joined from entity tables and
`definition.describe(input)` for titles.

## Wire exposure

Read models cross process boundaries with the existing wire live-state
machinery — the kernel adds no transport:

- Each surface exposes a **live-state family** keyed by its query scope
  (per repo, per workspace, per project), whose compute function is
  `engine.query()` + folds.
- **Pokes come from the write side's existing events**: admission commit
  and every settlement already poke dispatch
  ([07 §internal loop](./07-engine-and-stores.md#the-internal-loop)); the
  same pokes invalidate live-state families. The transition journal append
  is the natural poke source — one journal row, one invalidation, no
  polling.
- Live progress rides its own per-operation stream
  ([06 §follow](./06-execution-and-handlers.md#follow-semantics)) and joins
  the durable read model only in the renderer — mixing the two server-side
  would put ephemeral data in durable payloads.

## Retention

Terminal records are history, and history is a product feature (audit,
"what happened last night"), not a cache to drop eagerly. The policy:

- Terminal records are kept for a per-plane retention window (weeks, not
  minutes) and pruned by a periodic sweep — itself a mundane operation.
- The journal shares its record's fate (FK cascade); no separate journal
  policy exists.
- Pruning never touches non-terminal records; a failed teardown from a
  month ago is still live intent until a human settles it.
- The `activityFeed` recency window is a *display* concern measured in
  minutes and unrelated to retention — conflating the two is how "the
  panel is empty but the row is stuck" bugs happen.
