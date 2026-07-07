# Live Models and Protocol

Live models are reactive JSON state containers. A server owns authoritative
state, emits ordered Immer patches, and clients apply those patches locally.
When a client detects a gap, it refetches a snapshot and resumes from the new
generation.

## Protocol Terms

The shared protocol lives in `src/live/protocol/index.ts`.

- `LiveSnapshot<T>` is the full state at a cursor:
  `{ generation, sequence, timestamp, data }`.
- `LiveUpdate` is an ordered delta:
  `{ generation, baseSequence, sequence, timestamp, delta, mutationIds? }`.
- `LiveCursor` is `{ generation, sequence }` and identifies a point in a live
  model stream.
- `LiveSource` is the common server-side shape consumed by the API layer:
  `snapshot()` plus `subscribe(cb)`.

`generation` changes when the server calls `reseed()`. `sequence` increments
for each effective patch in a generation. `baseSequence` must equal the
client's current sequence; otherwise the client has missed an update and
resyncs from `snapshot()`.

## Server

`LiveModelServer<T>` owns one authoritative state object. Mutate it with
`produce()`, not by mutating the original object:

```ts
const server = new LiveModelServer<TaskListState>(
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
no update is emitted and the current cursor is returned. `reseed(next)` replaces
the generation and optionally the state; clients discover the generation jump on
the next update or snapshot.

See [../examples/live-model/server.ts](../examples/live-model/server.ts).

## Client

`LiveModelClient<T>` validates snapshots and patched state against a Zod schema:

```ts
const client = new LiveModelClient(taskListSchema, fetchSnapshot, (value, meta) => {
  console.log('client state:', value, meta);
});

client.seed(await fetchSnapshot());
const detach = attach((update) => client.applyUpdate(update));

const mutationSettled = client.waitForMutation('example-add-task');
addTask('Apply the first patch', 'example-add-task');
await mutationSettled;
```

The `onChange` callback receives `LiveChangeMeta`:

```ts
type LiveChangeMeta =
  | { kind: 'seed' }
  | { kind: 'update'; mutationIds: string[] };
```

Use `kind: 'seed'` as an authoritative reset signal. Optimistic overlays should
clear pending local recipes on seed. Use `kind: 'update'` and `mutationIds` to
confirm specific client mutations atomically with the authoritative state swap.

`waitForCursor(cursor)` resolves when the client has applied at least that
cursor. `waitForMutation(id)` resolves when a tagged update with that mutation
id arrives; a seed also resolves mutation waiters because a fresh snapshot is
authoritative.

See [../examples/live-model/client.ts](../examples/live-model/client.ts).

## BatchedLiveModel

`BatchedLiveModel<T>` wraps a `LiveModelServer<T>` and queues mutators before
flushing them into one `server.produce()` call. The default scheduler batches
within a microtask, and `timerScheduler(ms)` batches over a time window.

```ts
const batched = new BatchedLiveModel(fileTree);

batched.enqueue(
  (draft) => {
    draft.files['src/new.ts'] = draft.files['src/old.ts'];
    delete draft.files['src/old.ts'];
  },
  { mutationIds: ['batch-rename'] }
);

batched.enqueue(
  (draft) => {
    draft.files['README.md'] = '# Example';
  },
  { mutationIds: ['batch-write'] }
);

const cursor = batched.flush();
```

All mutation ids from the flushed batch are emitted on the single update. That
lets multiple client-side mutation waiters settle from one patch.

See [../examples/batched-model/client.ts](../examples/batched-model/client.ts).
