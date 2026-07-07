# Live Jobs

Live jobs model async work as a live state machine. They are useful when callers
need both a final result and a stream of progress updates.

## State Shape

The protocol helper `liveJobStateSchema(progress, result, error)` creates a
schema for this union:

```ts
type LiveJobState<P, R, E> =
  | { status: 'running'; startedAt: number; progress: P[]; progressCount: number }
  | { status: 'succeeded'; result: R }
  | { status: 'failed'; error: E }
  | { status: 'cancelled' };
```

`progress` is a retained ring of recent progress entries. `progressCount` is the
total number of progress events emitted, including entries that may have rolled
out of the retained ring.

## Server

`LiveJobServer` accepts an async handler and an error-mapping function:

```ts
const successfulJobs = new LiveJobServer<Input, Progress, Result, ErrorState>(
  async (input, ctx) => {
    await delay();
    ctx.progress({ step: 'checkout' });
    await delay();
    ctx.progress({ step: 'build' });
    return { message: `Finished ${input.name}` };
  },
  toError
);

const jobId = successfulJobs.start({ name: 'demo job' }).jobId;
```

Handlers receive `LiveJobContext`:

- `ctx.progress(value)` appends retained progress and emits an update.
- `ctx.signal` is an `AbortSignal`; reject or return after abort to finish the
  job as cancelled/failed depending on the server path.

The server exposes each job as a live model-like source:

```ts
export async function fetchSuccessfulSnapshot(jobId: string) {
  return getJob(successfulJobs, jobId).snapshot();
}

export function attachSuccessful(jobId: string, push: (update: LiveUpdate) => void) {
  return getJob(successfulJobs, jobId).subscribe(push);
}
```

See [../examples/live-job/server.ts](../examples/live-job/server.ts).

## Client

`LiveJobClient` wraps the live model state and gives callers a `result` promise:

```ts
const jobId = startSuccessfulJob();
const client = new LiveJobClient(jobStateSchema, {
  refetchSnapshot: () => fetchSuccessfulSnapshot(jobId),
  onState: (state) => console.log('job state:', state.status),
});

client.onProgress((progress) => console.log('job progress:', progress.step));
client.seed(await fetchSuccessfulSnapshot(jobId));
const detach = attachSuccessful(jobId, (update) => client.applyUpdate(update));

console.log('job result:', await client.result);
detach();
```

If the job fails, `client.result` rejects with `LiveJobFailedError`. If it is
cancelled, it rejects with `LiveJobCancelledError`:

```ts
const result = client.result.catch((error: unknown) => error);
cancelCancellableJob(jobId);
const error = await result;

if (error instanceof LiveJobCancelledError) {
  console.log('job cancelled:', error.name);
}
```

See [../examples/live-job/client.ts](../examples/live-job/client.ts).

## Retention and Cleanup

`LiveJobServer` retains terminal job state for a short window after completion
so late clients can still fetch a result snapshot. Dispose job servers when the
owning session or resource shuts down:

```ts
successfulJobs.dispose();
cancellableJobs.dispose();
```
