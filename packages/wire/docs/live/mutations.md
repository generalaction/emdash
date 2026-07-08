# Mutations

Mutations connect API calls to live model updates. A mutation can update one
model, many instances of one model, or several model refs. The key extra piece
is the `mutationId`: it tags emitted `LiveUpdate`s so clients can prove their
bound live models have observed the mutation.

## Why Mutation IDs Exist

An RPC result only tells the caller that the server handler finished. It does
not prove every live subscription in the UI has applied the corresponding
patches. Mutation ids bridge that gap:

```ts
server.produce(
  (draft) => {
    draft.tasks.push({ id: 'task-2', title: 'Apply the first patch', done: false });
  },
  { mutationIds: ['example-add-task'] }
);
```

The update carries `mutationIds: ['example-add-task']`. A replica can resolve
`waitForMutation('example-add-task')` when its local model applies that update.

## Hosts and Context

Live model contract mutations run against a keyed `LiveModelHost` instance. The
host owns each instance's member `LiveModel`s and resolves schema-only mutation
handlers supplied at host creation:

```ts
const sessions = createLiveModelHost(sessionContract, {
  mutations: {
    setTitle: (ctx, input) => {
      ctx.produce('metadata', (draft) => {
        draft.title = input.title;
      });
      return ok({ title: input.title });
    },
  },
});

sessions.create({ sessionId: 'demo' }, {
  metadata: { title: 'Untitled' },
  transcript: { items: [] },
});
```

Keys use `stableStringify()`, so object key order does not matter when hosts and
client bindings look up an instance. `GroupMutationContext` is instance-bound:
`ctx.key` identifies the current host instance and `ctx.produce(member, mutator)`
records the cursor of every touched member model. The wire result is:

```ts
type LiveMutationResult<D, E> =
  | { success: true; data: { data: D; cursors: LiveCursorEntry[] } }
  | { success: false; error: E };
```

The `data.data` value is the domain result. `data.cursors` tells the client which
live model bindings need to catch up.

## Client Settling

`LiveModelReplica.acquire(key)` returns a `ReplicaInstance` for one group key. Its
mutation methods call the thin group and then settle against the local
`ReplicaModel`s.

Group mutation methods return `{ result, settled }`:

```ts
const sessions = createLiveModelReplica(api.session, thin.session);
const lease = sessions.acquire({ sessionId: 'demo' });
const session = await lease.ready();

const added = await session.mutations.addNote({ text: 'Typed client mutation' });
await added.settled;
await lease.release();
await sessions.dispose();
```

`settled` waits for every cursor in the mutation result. For each cursor entry,
it resolves when either:

- the matching binding applies an update tagged with the mutation id, or
- the matching binding reaches the returned cursor.

This lets UI code safely read live client snapshots after `await settled`.

## Group Contract Mutations

The API layer integrates mutations through `defineLiveModelContract()` member
mutations. Each group mutation becomes a client method:

```ts
const updated = await session.mutations.setTitle({ title: 'Grouped wire' }, {
  mutationId: 'custom-mutation',
});
await updated.settled;
```

If no id is provided, the replica mutation helper generates one with
`createMutationId()`.
Explicit ids are useful for optimistic previews, where the preview and server
mutation must share the same confirmation id.

## Idempotency and Retries

`MutationResultCache` is the server-side idempotency cache used by
`bindContract()`. It stores settled mutation results by `mutationId` and shares
one in-flight execution for concurrent duplicates.

By default, `bindContract()` creates a cache with:

- `DEFAULT_MUTATION_RESULT_CACHE_TTL_MS` (5 minutes).
- `DEFAULT_MUTATION_RESULT_CACHE_MAX_ENTRIES` (1000).

Configure or disable it through `mutationDedupe`:

```ts
const controller = bindContract(api, {
  session: sessionsHost,
}, {
  mutationDedupe: { ttlMs: 60_000, maxEntries: 500 },
});

const withoutDedupe = bindContract(api, { session: sessionsHost }, { mutationDedupe: false });
```

The client retries `DISCONNECTED` mutation calls with the same `mutationId` by
default:

```ts
await session.addNote(input, {
  mutationId: 'add-note-1',
  retry: { maxRetries: 1 },
});
```

Set `retry: false` to disable retries for a specific call. Retries never happen
for `CANCELLED` errors.

The cache is process-local and temporary. It provides at-most-once behavior
within one server process lifetime, not durable exactly-once semantics. If a
mutation has durable side effects such as database writes, store the
`mutationId` in that domain layer too.

Use `procedure()` for API calls that do not need live model cursor settling.
`mutation()` is only valid as a member of `defineLiveModelContract().mutations`
in the contract API.

See [../../examples/group/client.ts](../../examples/group/client.ts),
[../../examples/optimistic-group/client.ts](../../examples/optimistic-group/client.ts),
and [../../examples/mutation-idempotency/client.ts](../../examples/mutation-idempotency/client.ts).
