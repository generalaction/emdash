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

## The creative operation

*Finite work that brings a resource into existence.* Claims are on keys,
not on existing things ([02](./02-resources-and-claims.md#claims-are-on-keys-not-on-existing-things)),
so provisioning claims the branch and worktree it is *about to create*:

```ts
const provisionWorkspace = defineOperation({
  name: 'provision-workspace',
  // ...
  key: (i) => `provision:${worktreeKey(i)}`,
  claims: (i) => [
    ...branchResource.mutates({ hostId: i.hostId, repoPath: i.repoPath, branchName: i.branchName }),
    ...worktreeResource.mutates({ hostId: i.hostId, path: i.worktreePath, repoPath: i.repoPath }),
  ],
});
```

Never claim the container exclusively "to be safe": the repo receives only
the implicit `intent-exclusive`, so isolated creations run in parallel
across a repo, while two operations creating the *same* branch name still
conflict at admission via the `exclusive` on the shared branch key.

## The observational operation

*Finite work that only reads: scans, measurements, git-stats collection.*
Today these are unmanaged reads, and the workspace scan cache hand-rolls
their in-flight dedupe; as operations they inherit dedupe, ordering,
progress, and history from the kernel:

```ts
const scanWorkspaceGitStats = defineOperation({
  name: 'scan-workspace-git-stats',
  input: gitStatsInputSchema,
  result: gitStatsResultSchema,
  error: gitStatsErrorSchema,
  key: (i) => `git-stats:${worktreeKey(i)}`,
  claims: (i) => worktreeResource.reads(i),      // shared + intent-shared ancestors
});
```

What each kernel property does for this one definition:

- **Dedupe on key**: two UI surfaces mounting simultaneously (workspaces
  list + detail page) submit the same scan and get the *same handle* — the
  scan cache's in-flight-collapse code path is deleted, not reimplemented.
  The cache itself shrinks to what it should be: a result cache, poked by
  scan settlement.
- **Shared×shared**: scans of the same worktree coexist with disk-usage
  measures of it, and with each other across worktrees — no lane
  serialization tax.
- **The conflict rows kill a race class at the source**:

```ts
on(teardownWorkspace,      scanWorkspaceGitStats).queue();   // destruction drains in-flight reads
on(scanWorkspaceGitStats,  teardownWorkspace).reject();      // scanning a dying path is senseless
```

The `reject` row is what eliminates the phantom-path family (git errors
from half-deleted directories, "worktree missing" artifacts): once a
teardown is admitted, every new scan of that path is refused with a typed
conflict naming the teardown, which the UI renders as "being removed". The
`queue` row means a running scan finishes cleanly before the directory
vanishes. Previously neither direction was coordinated at all, and the
symptoms were patched downstream per display surface.

Convert a read only when it earns the row — the (a)/(b)/(c) test in
[02 §what-to-model](./02-resources-and-claims.md#what-to-model--and-what-not-to).
Cheap reads stay plain function calls.

## The consistent subtree read

*A read of a whole subtree that must be internally consistent.* Measuring a
repo's total disk usage while provisions and teardowns mutate its worktrees
yields numbers that never added up; a `shared` claim on the *parent* fixes
it in one line:

```ts
const measureRepoUsage = defineOperation({
  name: 'measure-repo-usage',
  // ...
  key: (i) => `measure:${repoKey(i)}`,
  claims: (i) => repoResource.reads(i),          // shared on the repo itself
});
```

Check the matrix on what this coexists with: worktree scans hold
`intent-shared` on the repo — `shared × intent-shared` ✓, so reads-below
continue during the measurement. Worktree teardowns hold `intent-exclusive`
— `shared × intent-exclusive` ✗, so the measure waits for in-flight
mutations to drain and blocks new ones for its (short) duration. The
result is a consistent snapshot with a derivable waiting state ("Measuring —
waiting for 1 teardown"). This sentence — *let reads-below continue, hold
mutations-below* — is inexpressible with lanes or exclusive-only claims at
any key granularity; it is the graded-gating payoff of the full matrix.

## The mixed-mode operation

*Work that mutates one resource while only reading another.* Pushing a
branch (the create-PR flow) is the textbook case:

```ts
const pushBranch = defineOperation({
  name: 'push-branch',
  // ...
  key: (i) => `push:${branchKey(i)}`,
  claims: (i) => [
    ...branchResource.mutates(i),                // exclusive on the branch ref
    ...worktreeResource.reads(i),                // shared on the worktree
  ],
});
```

Three interleavings that were previously "hope git and timing cooperate"
become specified: a teardown (claiming the worktree and the branch)
conflicts on both keys and the table's `queue` row keeps the user's
delete-task click from yanking the branch out from under an in-flight push;
status scans of the same worktree run *during* the push
(`shared × shared` ✓) so the UI keeps updating while a slow remote grinds;
and two pushes of the same branch dedupe on key while pushes of different
branches in the same repo coexist.

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
