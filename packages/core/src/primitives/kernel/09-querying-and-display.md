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

## Previewing plans before admission

Compiled commands ([08 §the-compiled-command](./08-usage-patterns.md#the-compiled-command))
produce an `OperationPlan` as pure data *before* anything is admitted —
which is what makes confirmation surfaces ("this will tear down 3
workspaces and delete 2 branches") a display fold, not a feature:

```ts
/** Pure fold over a not-yet-submitted plan: the same tree shape the live
 *  folds produce, with every node in a synthetic 'proposed' state and
 *  labels from definition.describe(input). */
export function planPreview(plan: OperationPlan): OperationTreeNode[];
```

Two rules keep preview honest and cheap:

- **Key correlation upgrades preview in place.** A preview node's identity
  is its member's `key` — the same key the admitted record will carry. On
  confirm, the UI submits the identical plan and each `proposed` node
  upgrades to the live record with the matching key; preview → `pending` →
  `running` → settled is *one tree whose nodes change status*, not two
  screens. (Dedupe and adoption make this exact: a member that coalesces
  into existing work upgrades to that existing record.)
- **Preview only what is bound.** An imperative coordinator's future is
  not data yet ([08 §binding time](./08-usage-patterns.md#binding-time-compiled-batches-vs-ctxrun)),
  so its preview shows what *is* static — the root operation, its
  `describe(input)`, and any steps whose inputs derive from the parent's
  input alone — and renders the dynamic remainder as exactly that ("then:
  open PR — depends on push result"). Never fabricate a full DAG for
  display; that is rebuilding the workflow engine the coordinator replaced
  with code. If a real screen ever needs richer previews, the smallest
  sound addition is an optional, explicitly non-binding `outline(input)`
  on the definition — display-only, never consulted by execution — named
  here so it gets designed deliberately rather than improvised.

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

## Reactive queries fetch through operations

The section above covers queries *about operations*. This one covers the
inverse dependency: wire state queries *about the world* (workspace lists,
git stats, disk usage) whose answers are produced by probing hosts. Those
probes are exactly the reads the kernel coordinates — so the reactive read
path layers onto operations instead of bypassing them:

```text
wire live-state family        (demand: who is watching, keyed by scope)
        │ demand appears / poke arrives
        ▼
read model (cache)            (last known answer + provenance timestamp)
        │ stale or missing
        ▼
read-coalescer facade         (freshness contract, demand counting)
        │ submits
        ▼
read operation                (claims, dedupe, ordering, progress)
```

Four rules keep the layering honest:

1. **Standing queries hold nothing.** A subscription's lifetime is demand,
   not work; a claim held for as long as a screen is open would block
   mutations indefinitely
   ([08 §anti-patterns](./08-usage-patterns.md#anti-patterns), "the
   standing claim"). The query triggers *finite* read operations and is
   re-poked by settlement — level-triggered demand, edge-triggered
   fetches.
2. **Expensive fetches are read operations.** Anything passing
   the conversion test ([02](./02-resources-and-claims.md#what-to-model--and-what-not-to))
   is submitted as a `reads(...)` operation and inherits
   coalescing (two surfaces mounting → one probe) and claim-ordering
   against mutations (no scanning a half-torn-down path)
   ([08 §observational](./08-usage-patterns.md#the-observational-operation)).
   Cheap pure reads stay ordinary function calls; the kernel is not a
   general RPC wrapper.
3. **Freshness is the facade's contract, stated once.** The coalescer owns
   the staleness decision (`minFresh`: serve the cached answer if newer
   than N, else attach to the in-flight probe, else submit) — the epoch
   escape hatch from [03 §key conventions](./03-operations.md#key-conventions-and-coalescer-contracts)
   is its implementation detail, not something query sites hand-roll.
4. **Demand drop is not cancellation.** When the last watcher leaves, the
   facade stops *submitting* refreshes — that is where nearly all the
   saving lives. An already-in-flight probe is left to finish rather than
   cancelled (reads are short by the conversion test, and a coalesced
   operation may have other interested consumers); its result still lands
   in the read model for the next arrival. A short demand *linger* (keep
   refreshing briefly after the last unsubscribe) absorbs navigation
   flapping.

The facade itself — demand leases bound to `Scope`, linger windows,
`minFresh` policy — is an app-edge component built *on* the kernel, named
here so it is designed deliberately: the kernel ships definitions and
handles; the facade ships when the first wire query migrates
([07 §migration](./07-engine-and-stores.md#migration) step 3).

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
