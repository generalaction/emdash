# Execution and handlers

The third gate: the work itself. A handler binds a definition to an
implementation at the execution edge; the engine runs it with cancellation,
retries, and a uniform progress channel. Everything domain-specific —
physical guards, probing, script execution, git plumbing — lives *inside*
the handler in ordinary code; the kernel sees only the contract.

## `createOperationHandler`

```ts
export function createOperationHandler<D extends AnyOperationDefinition>(
  definition: D,
  run: (ctx: HandlerContext<InputOf<D>>) => Promise<ResultOf<D>>
): OperationHandler<D>;

export interface HandlerContext<TInput> {
  /** Parsed and version-upgraded via definition.input. */
  input: TInput;

  /** The record's id and attempt number, for logging and idempotency keys. */
  operationId: string;
  attempt: number;

  /**
   * Fired on cancellation, supersession, and graceful shutdown, with the
   * cause attached (see §abort-reasons). Handlers must observe it at every
   * await point that can be long (script execution, network); the engine
   * passes it into exec/fetch primitives that accept signals.
   */
  signal: AbortSignal;

  /**
   * Structure a unit of work as a named stage. Feeds the progress stream:
   * the stage appears as 'running' when entered, 'succeeded'/'failed' when
   * settled. Nesting is allowed one level (substages).
   */
  stage<T>(id: string, label: string, work: (stage: StageContext) => Promise<T>): Promise<T>;

  /**
   * Submit a child operation and await its typed result (see §ctx.run).
   * parentId and the operation initiator are set automatically.
   */
  run<D extends AnyOperationDefinition>(
    definition: D,
    input: InputOf<D>
  ): Promise<Result<ResultOf<D>, OperationFailure<ErrorOf<D>>>>;

  /** Submit a child operation without awaiting it (fire-and-track). */
  spawn<D extends AnyOperationDefinition>(definition: D, input: InputOf<D>): Promise<{ id: string }>;

  /**
   * Terminal escape hatches, expressed as returns rather than throws:
   * reject = "reality disagrees with this intent; retrying cannot help".
   */
  reject(error: ErrorOf<D>): never;

  /**
   * Attach structured facts to the terminal outcome summary. Write-only:
   * handlers never read facts back (see §facts-are-write-only).
   */
  fact(key: string, value: unknown): void;
}

export interface StageContext {
  /** Fractional progress within this stage, for long copies/clones. */
  progress(fraction: number): void;
  signal: AbortSignal;
}
```

A complete handler reads as the operation's runbook:

```ts
const teardownHandler = createOperationHandler(teardownWorkspace, async (ctx) => {
  // Physical guard first — always. Claims are advisory (01 §4).
  const state = await probeWorktree(ctx.input.path);
  if (state.kind === 'already-gone') {
    ctx.fact('probe', 'worktree already removed');
    return { removed: false, alreadyGone: true };   // success: goal state holds
  }
  if (state.kind === 'not-a-worktree') {
    ctx.reject({ code: 'not-a-worktree', path: ctx.input.path });
  }

  await ctx.stage('scripts', 'Run teardown scripts', ({ signal }) =>
    runTeardownScripts(ctx.input, { signal }));
  await ctx.stage('worktree', 'Remove worktree', () =>
    removeWorktree(ctx.input));
  if (ctx.input.deleteBranch) {
    await ctx.stage('branch', 'Delete branch', () =>
      deleteBranch(ctx.input));
  }
  return { removed: true };
});
```

### The three outcome channels

How a handler ends determines the record's terminal status:

| Handler behavior | Status | Semantics |
|---|---|---|
| returns `TResult` | `succeeded` | Goal state reached (including "was already reached") |
| calls `ctx.reject(TError)` | `rejected` | Reality refuses this intent; retrying is pointless |
| throws / returns rejected promise | `failed` (after retries) | The attempt broke; retrying may help |

The `reject`/`throw` split is the retryability contract from
[03 §statuses](./03-operations.md#statuses), expressed at the API level so
handler authors are forced to decide which failure they have. A thrown
error is wrapped into an `OperationErrorSummary`; a rejected error is
validated against `definition.error`, **persisted on the record**
([03 §the-record](./03-operations.md#the-record)), and typed end to end on
the handle. A returned result is likewise persisted before the terminal
transition — settlement writes payload and status in one store write.

### Unparseable stored input

Before invoking the handler, the engine parses the stored input through
`definition.input`. If parsing fails — `invalid` data, `needs-context`, or
a `future-version` the current schema doesn't know — the operation goes
directly to **`failed` with a parse-error summary, non-retryable, handler
never invoked**. On a single-instance plane there is no newer app coming
along to rescue a `future-version` row; leaving it `pending` "for later" is
a stuck row holding claims forever. Failing loudly puts it in the error
surfaces where a human can resubmit the intent.

### Physical guards and probing are handler-internal

Deliberately absent from the kernel: precondition hooks, probe declarations,
idempotency frameworks. A handler's first act is checking reality, and
"goal state already holds" is a *success* (return early with a fact), not
an error — that is what makes retries and crash-recovery re-dispatch safe.
The kernel cannot generalize this usefully because the right strategy is
per-operation (probe-then-act for teardown, marker files for provisioning,
`--force-with-lease` semantics for git pushes). What the kernel provides is
the *slot* where such code runs and the guarantee it will re-run on retry.

## `ctx.run` and `ctx.spawn`: operations from inside handlers

A handler may submit child operations. `ctx.spawn` submits and returns the
child's id; `ctx.run` submits and **awaits the typed result**. Both set
`parentId` and the `{ kind: 'operation' }` initiator automatically, and
both go through ordinary admission — dedupe, conflicts, the ancestor
exemption all apply.

`ctx.run` is what makes **imperative coordinators** possible: a handler
that sequences steps, branches on their results, and reads as a plain
async function:

```ts
const shipTaskHandler = createOperationHandler(shipTask, async (ctx) => {
  const pushed = await ctx.run(pushBranch, { worktree: ctx.input.worktree });
  if (!pushed.ok) ctx.reject({ code: 'push-failed', cause: pushed.error });

  const pr = await ctx.run(createPullRequest, {
    branch: pushed.value.remoteBranch,
    title: ctx.input.title,
  });
  if (!pr.ok) ctx.reject({ code: 'pr-failed', cause: pr.error });
  return { prUrl: pr.value.url };
});
```

Two contracts make this durable **without deterministic replay**:

- **The re-entrancy contract.** If the process crashes mid-coordinator, the
  parent record resets to `pending` and the handler re-runs *from the top*.
  Each `ctx.run` re-submits its child — and dedupes by key. A child that
  already settled returns its **persisted typed result instantly** (this is
  why results are stored, [03 §the-record](./03-operations.md#the-record));
  a child still running is awaited; a child never submitted is created. The
  coordinator "resumes" by re-walking its own code and coalescing into the
  durable work that already exists
  ([01 §identity](./01-concepts.md#durable-identity-is-the-unifying-mechanism)).
- **The weak determinism rule.** Child *keys* must derive deterministically
  from the parent's input — never from clocks, randomness, or mutable
  state read at runtime. This is the only determinism the kernel asks for,
  and violating it degrades safely: a drifting key spawns *duplicate
  visible work* (a second operation in the log, admission-checked like any
  other), never corruption or silent divergence. Contrast with replay-based
  engines, where nondeterminism corrupts history invisibly.

A parent blocked in `ctx.run` remains `running` and **keeps its claims** —
this is the deliberate hold-and-wait reintroduction documented in
[05 §deadlock](./05-dispatch.md#why-queueing-cannot-deadlock--and-where-the-proof-stops),
with the claim-discipline that accompanies it.

## Two coordinator styles

Both produce the same records and the same operation tree; they differ in
how the parent expresses its plan — the same act at different **binding
times** (the fan-out is knowable from a snapshot at submission, or only
from results during execution; see
[08 §binding time](./08-usage-patterns.md#binding-time-compiled-batches-vs-ctxrun)
for the decision rule). Choose by shape of the work:

| | Declarative (`submitBatch`) | Imperative (`ctx.run`) |
|---|---|---|
| Fan-out is | static, known at submission | dynamic, discovered step by step |
| Sequencing | none — children run per dispatch | explicit `await` order, branching |
| Parent settles via | `waiting-children` + propagation policy | its own return value |
| Failure handling | declared (`fail-parent` / `tolerate`) | ordinary code on typed results |
| Best for | delete project → N teardowns | push → PR → notify pipelines |

The styles converge underneath: a parent whose handler returns while
`ctx.spawn`-ed children are still non-terminal enters `waiting-children`
like any declarative parent, and its declared propagation policy governs
settlement from there. `ctx.run` children, by construction, are settled
before the handler returns.

Stages exist for exactly two purposes: **observability** (the checklist —
what is this operation doing, what failed) and **structuring compensation**
inside a handler. They have no identity in the log, no claims, no
independent retry or cancellation, and they do not survive restart — after
a crash the whole operation re-runs and the handler's idempotency skips
completed work. The crispest form of the rule: **operations are the
durability and claim boundaries; stages are neither.**

Four questions decide whether a candidate step is a stage or its own
operation:

| Question | Yes → operation | No → stage |
|---|---|---|
| Should *other* work legitimately interleave between this step and the next? | operation | stage |
| Does this step contend on **different resources** than its siblings, held for a **long time**? | operation (split, so claims stay narrow) | stage |
| Is this step too expensive to redo if the process dies right after it? | operation (its record is the checkpoint) | stage |
| Does anyone need to retry, cancel, or dedupe this step *independently*? | operation | stage |

Worked both ways: workspace provisioning — create branch, create worktree,
run setup scripts — is correctly **one operation with three stages**: every
step targets the same branch/worktree pair, so splitting adds durability
boundaries without releasing anything anyone else wants. Project deletion is
correctly a **coordinator with child operations**: one big operation
claiming every worktree would hold worktree #1's claim hostage while
worktrees #2–10 tear down; children each claim one worktree for exactly
their own duration.

The second row is the claim-scope guard, and it cuts both ways. An
operation holds *all* its claims for its *full* duration — so the
per-definition review question is: *is every claim a resource this handler
actually touches exclusively, for roughly the whole duration?* If a claim
is needed for only the first tenth of a long handler (a repo-level step
before long setup scripts), that is the signal to split. The claim-holding
profile, not the step count, decides.

## Stages and progress

Progress is live and ephemeral; only the terminal summary persists
([01 §6](./01-concepts.md#6-live-progress-vs-durable-outcome)).

### The shape

```ts
export interface OperationProgress {
  operationId: string;
  stages: OperationStage[];
  updatedAt: number;
}

export interface OperationStage {
  id: string;
  label: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped';
  progress?: number;            // 0..1, from StageContext.progress
  error?: { message: string };
  substages?: OperationStage[]; // one level deep
}
```

### The flow

`ctx.stage` writes into a **`ProgressSink`** — the engine's port for
progress publication:

```ts
export interface ProgressSink {
  publish(progress: OperationProgress): void;
  end(operationId: string): void;
}
```

The kernel stops at the sink. At the app edges:

- The **host** adapts its sink onto wire live state, keyed by operation id —
  the existing live-model plumbing the workspace operations panel already
  consumes.
- The **desktop**, for host-executed operations, *bridges* the host's
  progress stream into its own sink under the desktop operation's id, so a
  desktop `handle.follow()` sees one continuous stage stream regardless of
  where the work runs. For desktop-local operations the sink publishes
  directly.
- The **renderer** renders `OperationProgress` with the existing checklist
  components; stage data has one shape everywhere, so there is exactly one
  checklist renderer.

There is no per-definition progress schema. Uniformity here is what makes
"every operation gets a checklist for free" true.

### `follow()` semantics

`handle.follow()` subscribes to the operation's progress stream, and its
edge cases are specified because the UI's most common subscribe is
mid-run:

- Subscribing to a **running** operation delivers the latest progress
  snapshot immediately (the engine keeps the last-published
  `OperationProgress` per running operation), then live updates.
- Subscribing to a **terminal** record delivers nothing and ends at once —
  history views read the durable `outcome`, not the stream.
- The stream ends when the operation settles; the terminal status arrives
  via the handle/record, not as a progress event.

### Stage-derived outcome

When the handler settles, the engine compresses the final stage states into
the durable `outcome` summary on the record:

```ts
outcome: {
  failedStage: 'scripts',                    // if any
  completedStages: ['probe'],
  facts: { probe: 'worktree already removed' },
}
```

History views and error surfaces read this; nothing ever needs the full
stage stream after settlement.

### Facts are write-only

Handlers **never read their own prior attempts' facts** — `ctx.fact` is an
append-only channel into the outcome summary, not a checkpoint store. A
retry or crash-recovery re-run makes its decisions from **physical guards
and child results**, never from what a previous attempt recorded about
itself.

This is the anti-replay guardrail. Branching on prior-attempt state is
checkpointing without determinism guarantees — the unsound middle ground
between this kernel's reality-guarded model (re-check the world, redo
cheaply, dedupe children by key) and a true replay engine's (deterministic
code, recorded effects). Systems in that middle ground resume from a
recorded state whose preconditions may no longer hold. If a handler is
tempted to read its own facts, the step it wants to skip should be a child
operation — settled children *are* the durable, typed memory of completed
work.

## Retries

Declared on the definition, executed by the engine:

```ts
retry: { maxAttempts: 3, backoff: { kind: 'exponential', baseMs: 2_000, maxMs: 60_000 } }
```

- A `failed` attempt below the cap transitions `running → pending` with
  `attempt + 1` and a not-before time; dispatch picks it up after the
  backoff elapses (the pending record simply isn't eligible until then).
  Claims are *retained* across retries — the operation never loses its place
  to a conflicting newcomer between attempts.
- `rejected` and `cancelled` never retry, regardless of policy.
- Crash-interrupted attempts (found `running` at boot) are reset to
  `pending` with `attempt` preserved but do **not** consume an attempt —
  the process dying is not evidence the work is broken.

## Cancellation

One mechanism end to end: an abort request transitions the record and fires
the handler's `AbortSignal` — but three distinct causes share the
mechanism, and each must settle to a *different* status.

### Abort reasons

```ts
export type AbortReason = 'cancel' | 'supersede' | 'shutdown';
```

The reason is attached when the signal fires, and settlement maps it:

| Reason | Fired by | Interrupted `running` record settles as |
|---|---|---|
| `'cancel'` | `handle.cancel()`, parent cancellation cascading down | `cancelled` |
| `'supersede'` | admission superseding a running incumbent ([04](./04-admission-and-conflicts.md#the-verbs)) | `superseded` |
| `'shutdown'` | `engine.shutdown()` ([07](./07-engine-and-stores.md#lifecycle)) | back to `pending`, attempt preserved — the work is *not* over |

Statuses must record what actually happened; before reasons existed, all
three causes would have collapsed into `cancelled`, making a quit-during-
teardown indistinguishable from a user abort.

### Mechanics

- `pending` → for `'cancel'` and `'supersede'`, settle directly
  (`cancelled` / `superseded`); nothing is running, nothing to unwind.
  Shutdown leaves pending rows untouched.
- `running` → signal fires with its reason; the handler is expected to stop
  at its next await point and throw the abort. The engine maps the
  abort-caused failure per the table above. A handler that ignores its
  signal delays the outcome until it settles — the engine never hard-kills
  mid-handler, because half-applied external effects are worse than slow
  cancellation.
- A parent aborted with `'cancel'` cascades the same reason to its
  non-terminal children; `ctx.run` awaits inside it reject with the abort.
- Stages interrupted by an abort surface as `failed` with an abort message
  in the final progress publish, then the stream ends.

## Where handlers live and run

Handlers are registered against definitions in the plane that executes them
([07 §registry](./07-engine-and-stores.md#the-registry)):

- **Host handlers** (teardown, provision, prune, scan) live with the host
  runtime and run in the workspace server or the local host process. This is
  where today's bootstrap-plan workflow becomes `ctx.stage` calls — the
  workflow engine's steps map 1:1 onto stages, removing the current
  stage-lifting adapter layer.
- **Desktop handlers** (pure DB work; coordinators that fan out children;
  the bridge handler that submits to a host and follows) live in the main
  process.

A definition without a registered handler in a given plane is submittable
there only as intent to *forward* (desktop → host); the engine refuses to
dispatch a record it cannot execute, which turns a missing registration into
a loud startup-time error rather than a stuck row.
