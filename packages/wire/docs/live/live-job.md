# Live Jobs

Live jobs model async work as a live state machine. They are useful when callers
need both a final result and a stream of progress updates.

## State Shape

`liveJobStateSchema(progress, result, error)` creates a schema for:

```ts
type LiveJobState<P, R, E> =
  | { status: 'running'; startedAt: number; progress: P[]; progressCount: number }
  | { status: 'succeeded'; startedAt: number; finishedAt: number; progress: P[]; result: R }
  | { status: 'failed'; startedAt: number; finishedAt: number; progress: P[]; error: E }
  | { status: 'cancelled'; startedAt: number; finishedAt: number; progress: P[] };
```

`progress` is a retained ring of recent entries. `progressCount` is the total
number of progress events emitted, including entries that may have rolled out of
the retained ring. Terminal states retain lifecycle timestamps and the most
recent progress entries, but they do not carry `progressCount`.

## Server

`LiveJob<I, P, R, E>` accepts a handler and an error mapper:

```ts
const jobs = new LiveJob<Input, Progress, Result, ErrorState>(
  async (input, ctx) => {
    ctx.progress({ step: 'checkout' });
    await build(input, ctx.signal);
    ctx.progress({ step: 'package' });
    return { artifact: `${input.target}.zip` };
  },
  (error) => ({ message: error instanceof Error ? error.message : String(error) }),
  { maxProgressEntries: 100 }
);

const { jobId } = jobs.start({ target: 'desktop' });
```

Options:

- `generation`: optional fixed generation for every job state model.
- `maxProgressEntries`: retained progress entries. Default:
  `DEFAULT_LIVE_JOB_MAX_PROGRESS_ENTRIES` (`100`).
- `terminalRetainMs`: how long terminal state remains attachable. Default:
  `LIVE_JOB_TERMINAL_RETAIN_MS` (5 minutes).
- `idFactory`: custom job id factory, useful for deterministic tests.
- `clock`: custom timestamp source, useful for deterministic tests.
- `onRunStarted`, `onRunChanged`, and `onRunEvicted`: optional hooks for callers
  that want to maintain their own job listing.

Handlers receive `LiveJobContext`:

- `ctx.progress(value)` appends retained progress and emits an update.
- `ctx.signal` is an `AbortSignal`. If the signal is aborted, the job finishes
  as `cancelled`.

`source(jobId)` returns a read-only live source for that job. `snapshot(jobId)` and
`getState(jobId)` are convenience accessors. `cancel(id)` aborts a running job.
`dispose()` aborts running jobs, clears eviction timers, and removes all job
state.

Terminal job state is retained for `LIVE_JOB_TERMINAL_RETAIN_MS` (5 minutes) so
late clients can reattach by id. This retention is process-local, not durable.

## Client

`LiveJobClient` wraps the live state and exposes a `result` promise:

```ts
const client = new LiveJobClient(jobStateSchema, {
  refetchSnapshot: () => fetchSnapshot(jobId),
  onState: (state) => console.log('job state:', state.status),
});

client.onProgress((progress) => console.log(progress.step));
client.seed(await fetchSnapshot(jobId));
const detach = attach(jobId, (update) => client.applyUpdate(update));

console.log(await client.result);
detach();
client.dispose();
```

If the job fails, `result` rejects with `LiveJobFailedError`. If it is cancelled,
it rejects with `LiveJobCancelledError`. Progress emitted by a seed is suppressed
so reattaching clients do not replay old progress as fresh events.

`LiveJobClient` also exposes `cursor`, `refresh()`, `waitForTerminal()`, and
`waitForProgressCount(count)` for parity with other live clients.

## Contract Endpoint

The API contract layer can expose a job directly:

```ts
const api = defineContract({
  build: job({
    input: z.object({ target: z.string() }),
    progress: z.object({ step: z.string() }),
    result: z.object({ artifact: z.string() }),
    error: z.object({ message: z.string() }),
  }),
});
```

On the server, bind the endpoint with `{ run, toError }`:

```ts
const controller = bindContract(api, {
  build: {
    run: async (input, ctx) => {
      ctx.progress({ step: 'compile' });
      return { artifact: `${input.target}.zip` };
    },
    toError: (error) => ({
      message: error instanceof Error ? error.message : String(error),
    }),
  },
});
```

The typed client exposes a thin job endpoint client. Use it directly for
low-level forwarding, or wrap it in `createLiveJobReplica()` when a consumer wants
ref-counted local state:

```ts
const jobs = createLiveJobReplica(api.build, thin.build, { retentionMs: 30_000 });
const lease = await jobs.start({ target: 'desktop' });
const handle = await lease.ready();

handle.onProgress((progress) => console.log(progress.step));
console.log(await handle.result);

await lease.release();

const reattachedLease = jobs.acquire(handle.jobId);
const reattached = await reattachedLease.ready();
console.log(await reattached.result);
await reattachedLease.release();
await jobs.dispose();
```

`ReplicaJob` exposes `jobId`, `ready`, `result`, `getState()`,
`onProgress(cb)`, and `cancel()`. The `LiveJobReplica` manager owns ref counting,
subscription sharing, and terminal-state retention.

Cancellation at the procedure/wire level is documented in
[serving](../api/serving.md#cancellation). Job cancellation is domain-level:
`ReplicaJob.cancel()` calls the generated `<path>.cancel` procedure, which calls
`LiveJob.cancel(jobId)`.

See [../../examples/job-contract/client.ts](../../examples/job-contract/client.ts)
and [../../examples/live-job/client.ts](../../examples/live-job/client.ts).
