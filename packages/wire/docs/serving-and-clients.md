# Serving and Clients

The API layer turns a contract into a server-side `Controller`, serves it over a
`WireTransport`, then creates a typed client over the matching transport.

## Binding a Controller

`bindContract(contract, { impl, registry, validate })` maps each endpoint to a
server implementation.

```ts
const registry = new LiveModelRegistry();
const notes = new LiveModelServer<NotesState>({ notes: [] }, 1000);
const activity = new LiveLogServer({ generation: 2000 });

registry.register(notesApi.notes, { sessionId: 'demo' }, notes);

export const notesController = bindContract(notesApi, {
  registry,
  impl: {
    notes: fromRegistry(),
    activity: () => activity,
    addNote: (ctx, input) => {
      const note = { id: `note-${notes.snapshot().data.notes.length + 1}`, text: input.text };
      ctx.produce(notesApi.notes, { sessionId: input.sessionId }, (draft) => {
        draft.notes.push(note);
      });
      activity.append(`added ${note.id}\n`);
      return ok(note);
    },
    clearNotes: () => {
      notes.produce((draft) => {
        draft.notes = [];
      });
      activity.append('cleared notes\n');
      return notes.snapshot().data;
    },
  },
});
```

Implementation mapping by endpoint kind:

- `procedure`: `(input, meta) => output | Promise<output>`.
- top-level `mutation`: `(ctx, inputWithMutationId) => Result<data, error>`.
- `liveModel`: `fromRegistry()` or `(key) => LiveSource`.
- `liveLog`: `(key) => LiveSource`.
- `liveModelGroup`: usually `fromRegistry()` after registering group instances.

`validate` controls Zod validation:

- `none` (default): no runtime validation.
- `inputs`: parse inputs and live keys.
- `full`: parse inputs, live keys, procedure outputs, and mutation outputs.

See [../examples/api-binding/controller.ts](../examples/api-binding/controller.ts).

## Serving

`serve(transport, controller)` listens for wire protocol messages:

- `call` invokes `controller.call(path, input, meta)`.
- `snapshot` calls `LiveSource.snapshot()`.
- `attach` subscribes to a live source and forwards `update` messages.
- `detach` unsubscribes.

```ts
const pair = memoryTransportPair();
serve(pair.right, notesController);
```

`serve()` returns an unsubscribe. Call it when the transport or server session
goes away.

## Connecting

`connect(transport)` creates a low-level `Connection`:

```ts
const connection = connect(pair.left);
await connection.hello();
```

Most callers use it immediately with `contractClient()`:

```ts
const client = contractClient(notesApi, connect(pair.left));
```

`Connection` supports:

- `call(path, input)`.
- `snapshot(topic)`.
- `attach(topic, push)`.
- `onDisconnect(cb)`.
- `hello()` protocol version handshake.

On disconnect, pending calls reject and existing attachments are re-requested.
Use the reconnecting transport wrapper when the underlying transport can be
reopened.

## Typed Client

`contractClient(contract, connection)` returns a client with the same nested
shape as the contract.

```ts
const notesBinding = client.notes(session, (state, meta) => {
  console.log('notes model:', state, meta.kind);
});

const activityBinding = client.activity(session, {
  onReset: (snapshot) => console.log('activity reset:', JSON.stringify(snapshot)),
  onAppend: (chunk) => console.log('activity append:', chunk.trim()),
});

await notesBinding.ready;
await activityBinding.ready;

const added = await client.addNote({ ...session, text: 'Typed client mutation' });
await added.settled;
await client.clearNotes(session);

await notesBinding.dispose();
await activityBinding.dispose();
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

The optional `MutationCallOptions` lets callers provide a mutation id:

```ts
await binding.bump({}, { mutationId: 'custom-mutation' });
```

See [../examples/api-client/client.ts](../examples/api-client/client.ts).

## Groups

Group clients return one flattened binding containing model bindings, mutation
methods, `ready`, and `dispose`:

```ts
const conversation = client.conversation(key, {
  state: (state) => console.log('state:', state),
  usage: (usage) => console.log('usage:', usage),
});

await conversation.ready;
const updated = await conversation.setTitle({ title: 'Grouped wire' });
await updated.settled;
await conversation.dispose();
```

For optimistic UI, prefer `OptimisticLiveModelGroup`, documented in
[utils](./utils.md), which wraps the group endpoint and exposes separate
`values.*` and `mutations.*` surfaces.

## Transport Matrix

- `memoryTransportPair()`: in-process paired transports for tests, examples, and
  local simulations.
- `port`: adapts a `postMessage`-style port with `on('message')` or compatible
  APIs.
- `dom-port`: adapts browser `MessagePort`.
- `electron`: adapts Electron IPC.
- `stream`: adapts Node streams, useful for subprocess or SSH stdio-style
  boundaries.
- `reconnecting`: wraps a transport factory and reconnects while preserving the
  `Connection` API.

The same contract, controller, and client code works across transports. Only the
transport construction changes.

## Multi-Window Sessions

`createWireSessionHub(controller)` serves the same controller to multiple
transport sessions:

```ts
const hub = createWireSessionHub(controller);
const pair = memoryTransportPair();
hub.open('window-1', pair.right);

const client = contractClient(api, connect(pair.left));
```

Each window gets its own transport and connection, but live sources can be shared
by the controller.

See [../examples/multi-window/client.ts](../examples/multi-window/client.ts).
