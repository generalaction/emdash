# Live Models and Protocol

Live models are reactive JSON state containers. A server owns authoritative
state, emits ordered Immer patches, and clients apply those patches locally.
When a client detects a gap, it refetches a snapshot and resumes from the new
generation.

## Protocol Terms

The shared protocol lives in `src/live/protocol`.

- `LiveSnapshot<T>` is the full state at a cursor:
  `{ generation, sequence, timestamp, data }`.
- `LiveUpdate` is an ordered delta:
  `{ generation, baseSequence, sequence, timestamp, delta, mutationIds? }`.
- `LiveCursor` is `{ generation, sequence }` and identifies a point in a live
  model stream.
- `LiveSource` is the common server-side shape consumed by the API layer:
  `snapshot()` plus `subscribe(cb)`.

`generation` changes when the server calls `reseed()`. `sequence` increments for
each effective patch in a generation. `baseSequence` must equal the client's
current sequence; otherwise the client has missed an update and resyncs from
`snapshot()`.

## Server

`LiveModel<T>` owns one authoritative state object. Mutate it with
`produce()`, not by mutating the original object:

```ts
const server = new LiveModel<TaskListState>(
  {
    tasks: [{ id: 'task-1', title: 'Read the plan', done: false }],
    filter: 'all',
  },
  1000
);

const cursor = server.produce(
  (draft) => {
    draft.tasks.push({ id: 'task-2', title: 'Apply the first patch', done: false });
  },
  { mutationIds: ['example-add-task'] }
);
```

`produce()` returns the cursor containing the change. If the mutator is a no-op,
no update is emitted and the current cursor is returned. `snapshot()` deep
clones the current state. `reseed(next?)` replaces the generation, resets
sequence to `0`, optionally replaces state, and forces clients to resync on the
next observed update.

## Client

`LiveModelClient<T>` consumes snapshots and updates:

```ts
const client = new LiveModelClient(schema, fetchSnapshot, (value, meta) => {
  render(value, meta.kind);
}, {
  topic,
  instrumentation,
  logger,
});

client.seed(await fetchSnapshot());
const detach = server.subscribe((update) => client.applyUpdate(update));
```

Options are optional:

- `topic`: included in resync observability events.
- `instrumentation`: receives resync events.
- `logger`: receives structured resync logs; otherwise the ambient logger is
  used.

The client resyncs when:

- an update arrives before `seed()`.
- `generation` differs from the local generation.
- `baseSequence` differs from the local sequence.
- Immer patch application throws.
- schema validation fails in non-production builds.

The reported resync reasons are `generation`, `sequence-gap`, `patch-failed`,
and `validation`. Schema validation is skipped when `NODE_ENV === 'production'`;
the generation and sequence checks are the primary correctness mechanism.

## Cursor and Mutation Waiters

`waitForCursor(cursor, timeoutMs?)` resolves when the client has reached a
cursor. `waitForMutation(mutationId, timeoutMs?)` resolves when an applied update
contains the mutation id, or when a seed/resync lands because the snapshot is
authoritative.

These waiters are used by mutation settling; see [mutations](./mutations.md).

## BatchedLiveModel

`BatchedLiveModel<T>` wraps a `LiveModel<T>` and coalesces queued mutators
into one `produce()` call:

```ts
const batched = new BatchedLiveModel(server, microtaskScheduler, {
  instrumentation,
  logger,
});

batched.enqueue((draft) => {
  draft.count += 1;
});
batched.enqueue((draft) => {
  draft.updatedAt = Date.now();
});
```

The default scheduler is `microtaskScheduler`. Use `timerScheduler(ms)` for a
time-windowed trailing debounce. If the combined batch throws, server state is
unchanged, the batch is dropped, and `batchDropped` instrumentation/logging is
emitted.

See [../../examples/live-model/client.ts](../../examples/live-model/client.ts)
and [../../examples/batched-model/client.ts](../../examples/batched-model/client.ts).
