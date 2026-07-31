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

## The compiled command

*Turning a user command into the batch above.* The batch does not spring
from UI code assembling members inline; each user command gets a **command
compiler** — one pure function per command that turns intent plus an
entity snapshot into a plan value:

```ts
// workspaces/operations/commands.ts — pure, colocated with the definitions
export interface OperationPlan {
  members: BatchMember[];   // exactly the submitBatch argument
  options: BatchOptions;    // initiator, propagation
}

export function compileDeleteProject(
  cmd: { projectId: string },
  snapshot: { project: ProjectRow; workspaces: WorkspaceRow[] }
): OperationPlan {
  return {
    members: [
      { definition: deleteProject, input: { projectId: cmd.projectId } },
      ...snapshot.workspaces.map((wt) => ({
        definition: teardownWorkspace,
        input: teardownInputFor(wt),
        parent: 0,
        adoptExisting: true,
      })),
    ],
    options: {
      initiator: { kind: 'user', action: 'delete-project' },
      propagation: 'tolerate',
    },
  };
}
```

The load-bearing decisions:

- **The plan is the batch — there is no plan entity.** The compiled value
  becomes records at admission, and the records (via `parentId`) *are* the
  durable form of the plan. Terraform's plan/apply split, with the
  operation log itself as the state file. Never store a plan table.
- **Pure over a snapshot, guarded at execution.** The compiler takes
  observed state as an argument — no IO — so it unit-tests with literal
  snapshots. Staleness is fine by construction: if a workspace vanished
  between snapshot and execution, the teardown's physical guard returns
  "already gone" as success ([01 §4](./01-concepts.md#4-claims-are-advisory-handlers-hold-the-guard)).
  The compiler does not need to be right; the handlers need to be honest.
- **Compilation feeds the outbox transaction.** The desktop command handler
  runs the compiler, then commits the entity mutation and `submitBatch` in
  one transaction ([04 §where admission runs](./04-admission-and-conflicts.md#where-admission-runs-per-plane)).
  Compilation stays pure; the transaction is the only effectful line.
- **Deterministic keys make compilation idempotent.** Each member's key
  derives from its resource, so re-running the same command coalesces into
  the same records via dedupe and adoption — a double-submitted command is
  free, not duplicated.
- **Compilation is what makes preview possible.** Because the plan exists
  as data before admission, the confirmation UI renders it with the same
  tree components that later render the live records
  ([09 §preview](./09-querying-and-display.md#previewing-plans-before-admission)).

### Binding time: compiled batches vs `ctx.run`

The compiled command and the imperative coordinator (§below) look like two
competing planners; they are the **same act — producing child submissions —
at different binding times**. A plan is nothing but a set of child
operations plus a coordination policy, and the only real question is when
the fan-out becomes knowable:

- **Early binding** (compiled batch): the fan-out is fully determined by
  the command input plus a snapshot. You get atomic admission, complete
  preview, and `waiting-children` settlement.
- **Late binding** (`ctx.run`): the fan-out depends on results that do not
  exist yet (open a PR against whatever branch the push produced). The
  plan cannot exist as data before execution because its inputs don't.

The two are not in tension because both routes converge on identical
artifacts — the same records, the same `parentId` tree, the same keys,
admitted through the same `admit`, displayed through the same folds. The
frontend cannot tell which style produced a tree, and that is the design
working.

The deeper unity: **an imperative coordinator is a compiler interleaved
with execution.** The weak determinism rule
([06 §ctx.run](./06-execution-and-handlers.md#ctxrun-and-ctxspawn-operations-from-inside-handlers))
— child keys derive deterministically from the parent's input — is
precisely the compiler's purity requirement relocated into code: the
*identity* of every step is compiled purely even when the *selection* of
steps is dynamic. That is why crash-resume works: re-running the handler
re-compiles the same plan prefix and coalesces into existing records by
key.

The decision rule compresses to one line: **compile everything a snapshot
can tell you; write code only for what execution must discover.** And its
smell test: if you find yourself wanting all-or-nothing admission across
imperative steps, the fan-out was actually static and should have been
compiled. Composition is free in both directions — a compiled batch member
may be an imperative coordinator, and a `ctx.run` child may be a definition
that elsewhere ships in compiled batches — so choosing wrong costs a
refactor, never an architecture.

## The imperative coordinator

*Sequenced, branching multi-step work* — where the declarative batch's
static fan-out doesn't fit, write the plan as code with `ctx.run`
([06 §two styles](./06-execution-and-handlers.md#two-coordinator-styles)).
"Ship this task" is the worked example: push the branch, then open a PR
with the pushed branch's name.

```ts
const shipTask = defineOperation({
  name: 'ship-task',
  // ...
  key: (i) => `ship:${i.taskId}`,
  // Deadlock discipline (05): claim only what this subtree exclusively
  // owns — the task. Never the repo or host; the children claim those.
  claims: (i) => taskResource.mutates(i),
});

const shipTaskHandler = createOperationHandler(shipTask, async (ctx) => {
  const pushed = await ctx.run(pushBranch, { worktree: ctx.input.worktree });
  if (!pushed.ok) ctx.reject({ code: 'push-failed', cause: pushed.error });

  const pr = await ctx.run(createPullRequest, {
    branch: pushed.value.remoteBranch,     // branching on a typed child result
    title: ctx.input.title,
  });
  if (!pr.ok) ctx.reject({ code: 'pr-failed', cause: pr.error });
  return { prUrl: pr.value.url };
});
```

The durability story, concretely: kill the app between the push and the PR.
On reboot, recovery resets `ship-task` to `pending`; it re-dispatches and
the handler re-runs from the top. The first `ctx.run` re-submits
`pushBranch`, which **dedupes by key into the already-succeeded child and
returns its persisted typed result instantly** — no second push, no replay
machinery. Execution continues to the PR step as if nothing happened. The
requirements this leans on: child keys derive deterministically from the
parent's input, and `pushBranch` itself is idempotent behind its physical
guard (`--force-with-lease` semantics). Each child is also independently
visible, retryable, and claim-scoped — the PR step contends on GitHub,
not on the worktree the push needed.

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
- **Broad claims on an awaiting coordinator** — a `ctx.run` coordinator
  claiming the repo or host it merely orchestrates over. An awaiting parent
  holds its claims while blocked — genuine hold-and-wait — so broad claims
  make cross-tree deadlock constructible
  ([05 §where the proof stops](./05-dispatch.md#why-queueing-cannot-deadlock--and-where-the-proof-stops)).
  Claim only what the subtree exclusively owns; let children claim what
  they touch.
- **Reading your own prior attempt's facts** — branching a retry on what a
  previous attempt recorded about itself. Facts are write-only
  ([06](./06-execution-and-handlers.md#facts-are-write-only)); decisions
  come from physical guards and settled child results. If a step is worth
  remembering, it is a child operation.
