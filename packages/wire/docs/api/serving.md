# Serving and Clients

The API layer turns a contract into a server-side `Controller`, serves it over a
`WireTransport`, and creates a typed client over the matching transport.

## Binding a Controller

`bindContract(contract, options)` maps each endpoint to server behavior:

```ts
const controller = bindContract(notesApi, {
  registry,
  validate: 'inputs',
  mutationDedupe: { ttlMs: 60_000, maxEntries: 500 },
  instrumentation,
  impl: {
    session: fromRegistry(),
    activity: () => activityLogServer,
    clearNotes: (input) => {
      instance.models.notes.produce((draft) => {
        draft.notes = [];
      });
      return instance.models.notes.snapshot().data;
    },
  },
});
```

Options:

- `impl`: server implementations keyed by the contract shape. Procedures receive
  `(input, meta)`. Jobs bind to `{ run, toError }`. Live models use
  `fromRegistry()` or a resolver. Live logs use a resolver. Groups usually use
  `fromRegistry()` after registering group instances.
- `registry`: a `LiveModelRegistry` used by `fromRegistry()`, top-level
  mutations, and group mutations to resolve runtime live model instances by
  `(refId, key)`.
- `validate`: `none` (default), `inputs`, or `full`. `inputs` parses call inputs
  and live keys; `full` also parses procedure, mutation, job progress, job
  result, and job error outputs where supported.
- `mutationDedupe`: `false` disables mutation idempotency. Otherwise
  `MutationResultCache` is enabled with default TTL and size, or with the
  provided `{ ttlMs, maxEntries }` options.
- `instrumentation`: optional `WireInstrumentation` hooks.

The registry is separate from the contract because live model instances are
runtime resources. A contract can be bound once, while conversations, sessions,
or windows register and unregister model instances over time.

See [../../examples/api-binding/controller.ts](../../examples/api-binding/controller.ts).

## Serving

`serve(transport, controller, options?)` listens for protocol messages:

- `call` invokes `controller.call(path, input, meta)`.
- `snapshot` calls `LiveSource.snapshot()`.
- `attach` subscribes to a live source and forwards `update` messages.
- `detach` unsubscribes.
- `cancel` aborts an in-flight call by id.

```ts
const pair = memoryTransportPair();
const stop = serve(pair.right, controller, {
  logger,
  instrumentation: loggerInstrumentation(logger),
});
```

`serve()` returns an unsubscribe. Call it when the transport or server session
goes away. It also aborts in-flight calls and detaches live subscriptions when
the transport disconnects or when the serve loop is disposed.

## Connecting

`connect(transport, options?)` creates a low-level `Connection`:

```ts
const connection = connect(pair.left, { instrumentation });
await connection.hello();
```

`Connection` supports:

- `call(path, input, { signal? })`.
- `snapshot(topic)`.
- `attach(topic, push)`.
- `onDisconnect(cb)`.
- `hello()` protocol version handshake.

On disconnect, pending calls reject with `WireError` code `DISCONNECTED`.
Existing attachments are re-requested when the transport accepts messages again,
which is useful with `reconnectingTransport()`.

## Typed Clients

`contractClient(contract, connection, options?)` returns a client with the same
nested shape as the contract:

```ts
const client = contractClient(notesApi, connection, { instrumentation });

const session = client.session({ sessionId: 'demo' }, {
  notes: (state, meta) => {
    console.log('notes model:', state, meta.kind);
  },
});

await session.ready;
const added = await session.addNote({ text: 'Typed client mutation' });
await added.settled;
await session.dispose();
```

Live model and live log accessors return `WiredLiveClient`:

```ts
type WiredLiveClient<TClient> = {
  client: TClient;
  ready: Promise<void>;
  dispose(): Promise<void>;
};
```

Mutations return `ContractMutationInvocation`:

```ts
type ContractMutationInvocation<D, E> = {
  result: LiveMutationResult<D, E>;
  settled: Promise<void>;
};
```

`MutationCallOptions` lets callers provide a `mutationId` and retry policy:

```ts
await session.addNote({ text: 'Optimistic title' }, {
  mutationId: 'custom-mutation',
  retry: { maxRetries: 1 },
});
```

See [../../examples/api-client/client.ts](../../examples/api-client/client.ts).

## Cancellation

Wire supports cooperative cancellation for procedure calls. The client sends a
protocol message for the call id:

```ts
{ kind: 'cancel', id: callId }
```

Typed procedure clients accept an optional `{ signal }` argument:

```ts
const abort = new AbortController();
const result = client.slowOperation({ id: 'task' }, { signal: abort.signal });

abort.abort();
await result; // rejects with WireError code CANCELLED
```

If the signal is already aborted, the call rejects locally without posting.
Server procedure handlers receive the same signal through `CallMeta`:

```ts
const controller = bindContract(api, {
  impl: {
    slowOperation: async (input, meta) => {
      await abortableWork(input, meta.signal);
      return { ok: true };
    },
  },
});
```

Cancellation is cooperative. Long-running handlers should pass the signal into
their own async work, listen for `abort`, or periodically check
`meta.signal?.aborted`. Mutations are not cancellable through this API; they use
`mutationId` for idempotency and retry. See [mutations](../live/mutations.md).

## Merging Controllers

`mergeControllers({ namespace: controller })` mounts child controllers under
procedure namespaces:

```ts
const api = mergeControllers({
  local: localController,
  upstream: relayController(upstreamConnection),
});

await api.call('local.echo', input);
```

The namespace is stripped before calling the child. Live ref ids are owned by
the child controller: duplicate static refs throw `DUPLICATE_LIVE_REF`.
Resolution checks static owners first, then dynamic controllers.

## Relays and Interception

`relayController(connection)` turns an upstream `Connection` into a local
`Controller`. Calls forward to `connection.call(path, input, { signal })`, so
cancellation propagates across hops.

The relay reports `liveRefIds()` as `'dynamic'` and its `resolveLive(topic)`
always returns a proxying `LiveSource`. Mount a catch-all relay after more
specific static controllers:

```ts
const controller = mergeControllers({
  local: withIntercepts(localController),
  upstream: relayController(upstreamConnection),
});
```

For endpoint interception, decorate a controller:

```ts
function intercept(controller: Controller): Controller {
  return {
    ...controller,
    call(path, input, meta) {
      if (path === 'expensiveStats') return cachedStats(input);
      return controller.call(path, input, meta);
    },
  };
}
```

If multiple dynamic relays are merged, the first one that resolves a topic wins.
Prefer one fallback relay per merged controller.

## Multi-Window Sessions

`createWireSessionHub(controller)` serves the same controller to multiple
transport sessions:

```ts
const hub = createWireSessionHub(controller);
const pair = memoryTransportPair();

hub.open('window-1', pair.right);
const client = contractClient(api, connect(pair.left));
```

Opening the same session id closes the previous transport. `close(id)` closes
one session. `dispose()` closes all sessions and calls `controller.dispose?.()`.

See [../../examples/multi-window/client.ts](../../examples/multi-window/client.ts).

## Server-Side Call Helpers

`deduplicateRequests(fn, options?)` wraps procedure implementations to share one
in-flight promise for identical inputs:

```ts
const controller = bindContract(api, {
  impl: {
    expensiveStats: deduplicateRequests(async (input) => {
      return await loadStats(input.repo, input.branch);
    }),
  },
});
```

Behavior:

- Default key is `stableStringify(input)`, so object property order does not
  matter.
- Only in-flight calls are deduplicated. Settled calls are not cached.
- Rejections are not cached.
- `meta.signal` is not part of the key and shared execution is not aborted by
  one caller.
- Do not wrap mutations; mutation idempotency is handled by `mutationId`.

See [../../examples/dedupe/server.ts](../../examples/dedupe/server.ts).
