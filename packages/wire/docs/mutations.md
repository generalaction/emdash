# Mutations

Mutations connect API calls to live model updates. A mutation can update one
model, many instances of one model, or several model refs. The important extra
piece is the `mutationId`: it tags emitted `LiveUpdate`s so clients can prove
their bound live models have observed the mutation.

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

The update carries `mutationIds: ['example-add-task']`. A `LiveModelClient` can
resolve `waitForMutation('example-add-task')` when it applies that update.

## Server Side

`LiveModelRegistry` maps a model ref and key to a `LiveModelServer`:

```ts
const registry = new LiveModelRegistry();
registry.register(treeRef, { rootPath: '/repo', sessionId: 'left-pane' }, leftTree);
registry.register(treeRef, { rootPath: '/repo', sessionId: 'right-pane' }, rightTree);
```

Keys use `stableStringify()`, so object key order does not matter. `instances()`
can match a partial key, which lets a mutation update every bound model instance
for one shared dimension:

```ts
const renameMutation = liveMutation<RenameInput, { renamed: boolean }, string>(
  registry,
  (ctx, input) => {
    ctx.produceAll(treeRef, { rootPath: input.rootPath }, (draft) => {
      renameInTree(draft, input.from, input.to);
    });
    return ok({ renamed: true });
  }
);
```

`MutationContext` captures the cursor of every touched model. The wire result is
a `LiveMutationResult`:

```ts
type LiveMutationResult<D, E> =
  | { success: true; data: { data: D; cursors: LiveCursorEntry[] } }
  | { success: false; error: E };
```

The `data.data` value is the domain result. `data.cursors` tells the client
which live model bindings need to catch up.

See [../examples/mutations/server.ts](../examples/mutations/server.ts).

## Client Side

`LiveBindingRegistry` tracks the `LiveModelClient` instances currently bound in
the UI:

```ts
const bindings = new LiveBindingRegistry();
const unregister = bindings.register(treeRef, key, client);
```

`createLiveMutationsClient()` wraps a caller and returns methods that include a
`settled` promise:

```ts
const mutations = createLiveMutationsClient(fileMutationDefs, caller, bindings);

const invocation = await mutations.rename({
  rootPath: '/repo',
  from: 'src/old.ts',
  to: 'src/new.ts',
});

if (!invocation.result.success) {
  throw new Error(invocation.result.error);
}

await invocation.settled;
console.log('settled left tree:', left.client.getSnapshot());
```

`settled` waits for every cursor in the mutation result. For each cursor entry,
it resolves when either:

- the matching binding applies an update tagged with the mutation id, or
- the matching binding reaches the returned cursor.

This lets UI code safely read live client snapshots after `await settled`.

See [../examples/mutations/client.ts](../examples/mutations/client.ts).

## Contract Mutations

The API layer integrates the same mechanism. A `mutation()` endpoint becomes a
client method returning `{ result, settled }`:

```ts
const added = await client.addNote({ sessionId: 'demo', text: 'Typed client mutation' });
await added.settled;
```

Under the hood, `contractClient()` generates a mutation id, sends it to the
server, and uses its internal `LiveBindingRegistry` to settle the returned
cursors. Callers can also provide a mutation id explicitly:

```ts
await binding.bump({}, { mutationId: 'custom-mutation' });
```

Explicit ids are useful for optimistic previews, where the preview and server
mutation must share the same confirmation id.

## Idempotency and Retries

The same `mutationId` is also the idempotency key for contract mutations. Server
binding keeps a bounded in-memory cache of settled mutation results keyed by
`mutationId`, and shares one in-flight execution for concurrent duplicates:

```ts
await client.addNote(input, { mutationId: 'add-note-1' });
await client.addNote(input, { mutationId: 'add-note-1' }); // returns cached result
```

This protects the common transport race where the server commits a mutation but
the client loses the response during a disconnect. The client retries
`DISCONNECTED` mutation calls with the same `mutationId` by default:

```ts
await client.addNote(input, {
  mutationId: 'add-note-1',
  retry: { maxRetries: 1 },
});
```

Set `retry: false` to disable retries for a specific call. Retries never happen
for `CANCELLED` errors.

The cache is intentionally process-local and temporary. It provides at-most-once
behavior within one server process lifetime, not durable exactly-once semantics.
If a mutation has durable side effects such as database writes, store the
`mutationId` in that domain layer too, for example with a unique constraint.

See [../examples/mutation-idempotency/client.ts](../examples/mutation-idempotency/client.ts).
