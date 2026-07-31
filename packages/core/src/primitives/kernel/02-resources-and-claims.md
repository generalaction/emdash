# Resources and claims

Resources give work an identity to contend on; claims express the
contention; modes and the compatibility matrix decide who may coexist. This
is the data layer everything else reads — admission, dispatch, and the UI
all operate on the flat claim lists produced here and never think about
hierarchy themselves.

## Modes

Four modes, with names chosen so a claim row in the database or a debug
tooltip explains itself:

```ts
export const claimModes = [
  /**
   * Read/observe the resource. Coexists with other shared claims, blocks
   * exclusive ones. Example: a scan or measurement of a worktree.
   */
  'shared',

  /**
   * Sole ownership: mutate, move, or destroy the resource. Blocks everything
   * else on the same resource. Example: teardown of a worktree.
   */
  'exclusive',

  /**
   * "Something below me is being read." Planted automatically on ancestors
   * (repo, host) when a descendant takes a shared claim. Never requested by
   * hand — defineResource's claim expansion produces it.
   */
  'intent-shared',

  /**
   * "Something below me is being changed." Planted automatically on
   * ancestors when a descendant takes an exclusive claim. Blocks
   * whole-subtree operations (e.g. repo-wide prune) until descendant work
   * drains, and vice versa.
   */
  'intent-exclusive',
] as const;

export type ClaimMode = (typeof claimModes)[number];
```

These are the classic multi-granularity locking modes (`S`, `X`, `IS`, `IX`
in the literature, `PR`/`EX`/`CR`/`CW` in the VMS DLM) with readable names.
There is deliberately no fifth mode; the DLM lineage's lesson is that mode
sets grow past comprehension long before they grow past usefulness.

## The compatibility matrix

One constant table, consulted by both admission (against the non-terminal
set) and dispatch (against the running set):

```ts
// COMPATIBLE[held][requested]
const COMPATIBLE: Record<ClaimMode, Record<ClaimMode, boolean>> = {
  //                     requested:  int-shared  int-excl  shared  exclusive
  'intent-shared':    { 'intent-shared': true,  'intent-exclusive': true,  shared: true,  exclusive: false },
  'intent-exclusive': { 'intent-shared': true,  'intent-exclusive': true,  shared: false, exclusive: false },
  shared:             { 'intent-shared': true,  'intent-exclusive': false, shared: true,  exclusive: false },
  exclusive:          { 'intent-shared': false, 'intent-exclusive': false, shared: false, exclusive: false },
};

export function modesCompatible(held: ClaimMode, requested: ClaimMode): boolean {
  return COMPATIBLE[held][requested];
}
```

The one genuinely unintuitive row is worth internalizing: **intent modes
coexist with each other** (`intent-exclusive` + `intent-exclusive` is fine —
two different worktrees of the same repo being torn down concurrently is
exactly what we want) but **conflict with real modes on the same node**
(`intent-exclusive` on a repo blocks `exclusive` on that repo — you cannot
prune the whole repo while any worktree inside it is being changed).

The matrix is symmetric. It ships with golden tests asserting every cell and
the symmetry property; it should never change without a design discussion.

## Claims are data

```ts
export interface ResourceClaim {
  /** Resource definition name, for display and debugging ('worktree', 'repo'). */
  resource: string;
  /** Canonical resource key — the identity claims collide on. */
  key: string;
  mode: ClaimMode;
  /** True for ancestor intents produced by claim expansion, false for the
   *  claim the operation actually asked for. Display code uses this to show
   *  "teardown of feat-x" rather than "intent-exclusive on repo". */
  implicit: boolean;
}
```

Nothing more. A claim has no identity of its own, no lifecycle methods, no
definition — it is a *relationship*, fully determined by the resource key,
the mode, and the operation that holds it. This is a deliberate decision:
earlier design rounds considered `defineClaim(...)` and rejected it, because
every property a claim definition would hold is already owned by either the
resource (identity, hierarchy) or the operation (purpose, lifetime).

Claims are computed once by `definition.claims(input)` at admission,
persisted on the record as JSON, and never re-derived. Admission, dispatch,
and the UI all read the same frozen list, so a change to a resource's
definition can never make old records mean something new.

## `defineResource`

A resource definition supplies exactly three things: a name, a key function,
and an optional parent link. From those, the kernel derives the full
multi-granularity claim expansion:

```ts
export interface ResourceDefinition<TName extends string, TRef> {
  name: TName;
  key: (ref: TRef) => string;
  /** This operation reads the resource; others may read concurrently. */
  reads: (ref: TRef) => ResourceClaim[];
  /** This operation changes or destroys the resource; nothing else may touch it. */
  mutates: (ref: TRef) => ResourceClaim[];
  /** Low-level escape hatch; reads/mutates cover normal use. */
  claim: (ref: TRef, mode: ClaimMode) => ResourceClaim[];
}

export function defineResource<TName extends string, TRef>(spec: {
  name: TName;
  key: (ref: TRef) => string;
  parent?: (ref: TRef) => ResourceParentLink;
}): ResourceDefinition<TName, TRef>;
```

`reads`/`mutates` is the public vocabulary on purpose: an operation author
answers "am I reading or changing this?" — never "which of four lock modes
do I want?". The intent modes are an implementation detail of the hierarchy
that expansion picks automatically.

### Claim expansion — where MGL actually happens

Multi-granularity locking in the kernel is **not a runtime tree traversal**.
It is expansion at claim-construction time: because a definition knows its
parent, `mutates(ref)` returns the explicit claim *plus* an implicit intent
claim on every ancestor.

```ts
// mutates → exclusive on self, intent-exclusive up the chain
// reads   → shared on self,   intent-shared up the chain
worktreeResource.mutates({ hostId, path, repoPath });
// ⇒ [
//   { resource: 'worktree', key: 'worktree:h1:/wt/feat-x', mode: 'exclusive',        implicit: false },
//   { resource: 'repo',     key: 'repo:h1:/repo',          mode: 'intent-exclusive', implicit: true  },
//   { resource: 'host',     key: 'host:h1',                mode: 'intent-exclusive', implicit: true  },
// ]
```

After expansion, hierarchy is *gone*. Every downstream consumer sees a flat
`(key, mode)` list and applies the matrix pointwise. This is what keeps
admission and dispatch tiny.

### The payoff

A repo-wide operation claims the repo — and conflicts with *any* worktree
operation through the implicit intents, without enumerating worktrees:

```ts
const pruneRepoWorktrees = defineOperation({
  // ...
  claims: (input) => repoResource.mutates({ hostId: input.hostId, path: input.repoPath }),
});
// exclusive on repo:h1:/repo  ×  intent-exclusive on repo:h1:/repo (held by any
// worktree teardown)  →  incompatible  →  prune waits for descendant work to
// drain, and new descendant work waits behind the prune (fairness, see 05).
```

Neither side knows the other's members. That single property is why the
hierarchy exists.

### The modelling cost

To plant an intent on the repo, a worktree ref must *carry* its repo path:

```ts
export const worktreeResource = defineResource({
  name: 'worktree',
  key: (ref: { hostId: string; path: string; repoPath: string }) =>
    hostResourceKey({ kind: 'worktree', hostId: ref.hostId, path: ref.path }),
  parent: (ref) => ({ def: repoResource, ref: { hostId: ref.hostId, path: ref.repoPath } }),
});
```

`repoPath` appears in the ref even though the key ignores it — the parent
link needs it. Operation inputs already have this information (workspaces
know their project root), so in practice this costs nothing, but it is the
rule to remember when defining a new resource: **the ref must contain enough
to identify every ancestor.**

### Where resource definitions live

Not in the kernel. The kernel exports `defineResource` and the claim types;
the concrete tree — `hostResource`, `repoResource`, `worktreeResource`,
`branchResource`, and desktop-side `projectResource`, `taskResource` — lives
with the domain (alongside `core/src/primitives/host-resource/api/`, whose
`hostResourceKey` encoding the definitions reuse). Same split as wire state:
the kernel is mechanism, the graph of actual nodes is the app's.

### What to model — and what not to

Only define a resource when operations actually *contend* on it. The test:
will two concurrent claimants ever hold incompatible modes on this key? If a
thing never has two concurrent actors, a resource definition adds vocabulary
without preventing anything. Keep the tree shallow — the four host levels
plus the two desktop levels cover every operation currently known — and
resist deep nesting: every level adds an implicit claim to every descendant
operation.

## Testing obligations

The data layer carries two non-negotiable test suites:

- **Golden matrix tests** — every cell of `COMPATIBLE` asserted literally,
  plus symmetry. The matrix is the kernel's constitution; a typo here is a
  concurrency bug everywhere.
- **Expansion property tests** — for every resource definition: an explicit
  `exclusive` on a node implies `intent-exclusive` on *every* ancestor; an
  explicit `shared` implies `intent-shared` on every ancestor; explicit
  claims are marked `implicit: false` and ancestors `implicit: true`; keys
  produced by expansion equal the keys the ancestor definitions produce
  directly.
