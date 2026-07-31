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
   * Fired on cancellation and supersession. Handlers must observe it at
   * every await point that can be long (script execution, network); the
   * engine passes it into exec/fetch primitives that accept signals.
   */
  signal: AbortSignal;

  /**
   * Structure a unit of work as a named stage. Feeds the progress stream:
   * the stage appears as 'running' when entered, 'succeeded'/'failed' when
   * settled. Nesting is allowed one level (substages).
   */
  stage<T>(id: string, label: string, work: (stage: StageContext) => Promise<T>): Promise<T>;

  /**
   * Terminal escape hatches, expressed as returns rather than throws:
   * reject = "reality disagrees with this intent; retrying cannot help".
   */
  reject(error: ErrorOf<D>): never;

  /** Attach structured facts to the terminal outcome summary. */
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
validated against `definition.error` and typed end to end on the handle.

### Physical guards and probing are handler-internal

Deliberately absent from the kernel: precondition hooks, probe declarations,
idempotency frameworks. A handler's first act is checking reality, and
"goal state already holds" is a *success* (return early with a fact), not
an error — that is what makes retries and crash-recovery re-dispatch safe.
The kernel cannot generalize this usefully because the right strategy is
per-operation (probe-then-act for teardown, marker files for provisioning,
`--force-with-lease` semantics for git pushes). What the kernel provides is
the *slot* where such code runs and the guarantee it will re-run on retry.

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

One mechanism end to end: `handle.cancel()` (or a supersede verb, or parent
cancellation cascading down) transitions the record and fires the handler's
`AbortSignal`.

- `pending` → `cancelled` directly; nothing is running, nothing to unwind.
- `running` → signal fires; the handler is expected to stop at its next
  await point and throw the abort. The engine maps an abort-caused failure
  to `cancelled`, not `failed`. A handler that ignores its signal delays
  cancellation until it settles — the engine never hard-kills mid-handler,
  because half-applied external effects are worse than slow cancellation.
- Stages interrupted by cancellation surface as `failed` with an abort
  message in the final progress publish, then the stream ends.

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
