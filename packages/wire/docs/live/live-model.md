# Live States and Protocol

Live states are reactive JSON state containers. A server owns authoritative
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
  state stream.
- `LiveSource` is the common server-side shape consumed by the API layer:
  `snapshot()` plus `subscribe(cb)`.

`generation` changes when the server calls `reseed()`. `sequence` increments for
each effective patch in a generation. `baseSequence` must equal the client's
current sequence; otherwise the client has missed an update and resyncs from
`snapshot()`.

## Server

`LiveState<T>` owns one authoritative state object. Mutate it with
`produce()`, not by mutating the original object:

```ts
const server = new LiveState<TaskListState>(
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

## Consumers

Consumers normally reach live states through a live model contract. Use the
contract client when you only need protocol access:

```ts
const model = contractClient.conversation.state({ sessionId }, 'state');
const snapshot = await model.snapshot();
const detach = await model.attach((update) => {
  console.log(update.delta);
});
```

Wrap that live state client handle in `createLiveModelReplica()` when a process wants local
state, mutation settling, ref counting, or a downstream `LiveSource`; see
[replicas](./replicas.md#model-replicas).

The package also has low-level protocol followers internally. They consume
snapshots and ordered updates, then resync when:

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

## BatchedLiveState

`BatchedLiveState<T>` wraps a `LiveState<T>` and coalesces queued mutators
into one `produce()` call:

```ts
const batched = new BatchedLiveState(server, microtaskScheduler, {
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

See [../../examples/live-state/client.ts](../../examples/live-state/client.ts)
and [../../examples/batched-state/client.ts](../../examples/batched-state/client.ts).
