# Usage patterns

The cookbook. Each pattern names the situation, shows the composition, and
states when to use it — and when not to. All examples assume the resource
tree and definitions from the earlier documents.

## The destructive operation

*The bread-and-butter case: finite work that changes or destroys a host
resource.* Teardown, branch delete, prune.

```ts
// definition (portable — imported by desktop UI and host runtime)
const teardownWorkspace = defineOperation({
  name: 'teardown-workspace',
  input: teardownInputSchema,
  result: z.object({ removed: z.boolean(), alreadyGone: z.boolean().optional() }),
  error: z.discriminatedUnion('code', [/* not-a-worktree, unmerged-branch, ... */]),
  key: (i) => `teardown:${hostResourceKey({ kind: 'worktree', hostId: i.hostId, path: i.path })}`,
  claims: (i) => worktreeResource.mutates({ hostId: i.hostId, path: i.path, repoPath: i.repoPath }),
  retry: { maxAttempts: 3, backoff: { kind: 'exponential', baseMs: 2_000, maxMs: 60_000 } },
});
```

Checklist for any new destructive operation:

- `key` includes host + path; excludes anything incidental.
- `claims` uses `mutates` — never hand-picked modes.
- Handler's first act is the physical guard; "already gone" returns success
  with a fact, `ctx.reject` for reality-mismatches, throw for transient
  breakage.
- Every long await forwards `ctx.signal`.
- The conflict table gets rows for every definition this can collide with —
  the default is `reject`, so forgetting a row fails loudly, not wrongly.

## The observational operation

*Finite work that only reads: scans, measurements, git-stats collection.*

```ts
const scanWorkspace = defineOperation({
  name: 'scan-workspace',
  // ...
  key: (i) => `scan:${worktreeKey(i)}`,
  claims: (i) => worktreeResource.reads(i),      // shared — scans coexist
});
```

Use an operation (rather than a plain function call) when the read is
expensive enough to dedupe, worth showing progress for, or must be ordered
against mutations. The `shared` claims give you all three: concurrent scans
coexist, identical scans dedupe on key, and the conflict table's
`on(teardown, scan).queue()` row sequences destruction behind in-flight
reads. Cheap reads that need none of this should stay plain function calls
— not everything deserves a durable row
([02 §what-to-model](./02-resources-and-claims.md#what-to-model--and-what-not-to)).

## The coordinator (parent/child tree)

*One user intent fanning out into many durable children.* Project deletion
is the canonical case.

```ts
const result = await engine.submitBatch(
  [
    { definition: deleteProject, input: { projectId } },
    ...workspaces.map((wt) => ({
      definition: teardownWorkspace,
      input: wt,
      parent: 0,             // index of deleteProject in this batch
      adoptExisting: true,   // re-parent a matching orphaned teardown instead of duplicating
    })),
  ],
  {
    initiator: { kind: 'user', action: 'delete-project' },
    propagation: 'tolerate', // project delete succeeds even if a teardown fails;
                             // failures land in the parent's outcome summary
  }
);
```

What the kernel gives you here: atomic all-or-nothing *admission*
([04 §batch](./04-admission-and-conflicts.md#batch-admission)); the parent
in `waiting-children` until the tree settles; declared failure propagation;
cancellation cascading down; roll-up display status; and provenance — every
child's root initiator traces to `delete-project`, so the UI renders
"Tearing down feat-x — part of deleting Acme".

What it does not give you: execution-time atomicity. Children settle
independently; a failed teardown leaves a failed row to retry or dismiss,
never an automatic un-delete of the project.

## Supersession

*Newer intent invalidates older.* The user deletes a task whose workspace is
still provisioning:

```ts
on(teardownWorkspace, provisionWorkspace).supersede();
```

Admission marks the pending provision `superseded` (terminal) — or, if it is
already running, fires its `AbortSignal` and holds the teardown `pending`
until the provision actually settles
([04 §verbs](./04-admission-and-conflicts.md#the-verbs)). The provision's
handle resolves with `{ kind: 'superseded' }`, which its call site treats as
a non-error.

Use `supersede` only when the newcomer genuinely makes the incumbent
pointless. If both should eventually happen, you want `queue`; if the
newcomer is the senseless one, you want `reject` on the *reversed* pair.

## Queue-behind

*Both operations are legitimate; order them.* Repo-wide prune vs worktree
work:

```ts
on(pruneRepoWorktrees, teardownWorkspace).queue();
on(teardownWorkspace, pruneRepoWorktrees).queue();
```

The prune claims `repoResource.mutates(...)`; every worktree operation's
implicit `intent-exclusive` on the repo collides with it; dispatch's
fairness barriers drain existing worktree work, run the prune alone, then
release the queued-up newcomers
([05 §worked example](./05-dispatch.md#a-worked-example)). The prune's
display state while waiting is derived: "Waiting for 2 operations on this
repository."

## Compensation

*Multi-step creative work that can fail halfway.* Provisioning creates a
worktree, then runs setup scripts; if scripts fail, the half-provisioned
worktree should not leak.

The kernel deliberately has no distributed-transaction story
([03 §trees](./03-operations.md#operation-trees)); compensation is a handler
pattern:

```ts
const provisionHandler = createOperationHandler(provisionWorkspace, async (ctx) => {
  const worktree = await ctx.stage('worktree', 'Create worktree', () => createWorktree(ctx.input));
  try {
    await ctx.stage('setup', 'Run setup scripts', ({ signal }) => runSetup(ctx.input, { signal }));
  } catch (error) {
    await ctx.stage('rollback', 'Remove partial worktree', () => removeWorktree(worktree));
    throw error; // still a failure — but a clean one
  }
  return { path: worktree.path };
});
```

Rules of thumb: compensate *creative* steps (undo what you made), never
destructive ones (you cannot un-delete); order steps so the irreversible one
is last (the "pivot"); and if compensation itself fails, let the operation
fail with both errors in the outcome — a failed row that a human can see
beats silent debris.

## Cross-plane operations

*Desktop intent, host execution.* The bridge-handler pattern that connects
the two planes ([07 §cross-plane](./07-engine-and-stores.md#cross-plane-composition)):

```ts
// Desktop-side handler for the same definition the host executes.
const teardownBridge = createOperationHandler(teardownWorkspace, async (ctx) => {
  const host = await hostClient(ctx.input.hostId);           // wire connection
  const remote = await host.operations.submit(teardownWorkspace, ctx.input);
  // Same key on both planes ⇒ resubmission after a connection drop dedupes
  // into the still-running host record and re-attaches the follow.
  remote.follow((p) => ctx.forwardProgress(p), { scope: ctx.scope });
  const result = await remote.result;
  if (!result.ok && result.error.kind === 'rejected') ctx.reject(result.error.error);
  if (!result.ok) throw bridgeError(result.error);
  return result.value;
});
```

The desktop record is the durable intent (survives restarts; a reconnect
re-runs the bridge, which dedupes host-side); the host record is the
execution truth; `handle.follow()` on the desktop sees the host's stages as
one continuous stream. Feature code cannot tell where an operation ran —
which is the point.

## Reconciler proposals

*The host notices debris; a client confirms.* Orphaned worktrees, prunable
git records.

The host's reconciler submits proposals into its own log as operations with
`initiator: { kind: 'reconciler', probe: 'orphaned-worktree' }` and a
definition whose admission requires confirmation — the record sits in the
log as visible, deduped, conflict-checked *proposed work*, surfaced by the
existing operations panel. Confirmation (a user action on the desktop)
transitions it into the normal pending→running flow. Deduplication on key
means a reconciler firing every hour never stacks duplicate proposals, and
a teardown admitted for the same worktree supersedes the proposal
automatically via the conflict table.

## Spawning long-lived processes

*The boundary case from [01 §7](./01-concepts.md#7-operations-vs-sessions).*
Starting an agent session is an operation; the session is not:

```ts
const spawnAgent = defineOperation({
  name: 'spawn-agent',
  // ...
  claims: (i) => worktreeResource.reads(i),   // shared: sessions coexist with scans
});

const spawnHandler = createOperationHandler(spawnAgent, async (ctx) => {
  const session = await ctx.stage('spawn', 'Start agent process', () => startAcpSession(ctx.input));
  // Hand off to the supervisor; the *session* holds a usage hold from here on.
  return { sessionId: session.id };
});
```

The operation settles as soon as the process is healthy — it never sits
`running` for the session's lifetime. The running session's relationship to
the worktree is a usage hold owned by the session supervisor, not a claim;
a teardown finding an active hold fails its physical guard with a typed
"workspace in use" rejection, which the UI turns into "stop the agent
first". The kernel's log stays a log of *work*, not a mirror of process
state.

## Anti-patterns

Recognize these before they ship:

- **The eternal operation** — modeling a session/server/watcher as a
  `running` operation. Use the spawn pattern above.
- **The micro-operation** — wrapping a cheap pure read in a durable row for
  uniformity's sake. Rows are for work that needs dedupe, ordering,
  progress, or history.
- **Hand-rolled exclusivity** — a feature checking "is something already
  happening to this path?" outside admission. That check *is* admission;
  route it through a definition and the conflict table.
- **Stored derived state** — persisting "waiting on X" or per-tick stage
  snapshots. Both are derivable; storing them creates staleness bugs
  ([05 §derived waiting](./05-dispatch.md#the-derived-waiting-state),
  [06 §stages](./06-execution-and-handlers.md#stages-and-progress)).
- **Claim-mode cleverness** — hand-picking `intent-*` modes in a
  definition's `claims`. Intent modes belong to expansion; if `reads`/
  `mutates` cannot express what you need, the resource tree is missing a
  level — fix the tree, not the modes.
- **Cross-plane admission** — asking the desktop to admit against a host's
  log or vice versa. Each plane is authoritative for its own log; the bridge
  pattern plus shared keys handles the coupling.
