# API Contracts

Contracts describe the API surface once. Server binding and client creation
derive their types from the same object.

## Defining a Contract

Use `defineContract({ ... })`. Object keys are significant: they determine
procedure paths and live ref ids after nested contracts are mounted.

```ts
export const notesApi = defineContract({
  activity: liveLog({ key: sessionKeySchema }),
  session: defineLiveModelContract({
    key: sessionKeySchema,
    models: {
      notes: notesStateSchema,
    },
    mutations: {
      addNote: mutation(
        { input: z.object({ text: z.string() }), data: noteSchema, error: z.string() },
        (ctx, input) => {
          const note = { id: input.text.toLowerCase(), text: input.text };
          ctx.produce('notes', (draft) => {
            draft.notes.push(note);
          });
          return ok(note);
        }
      ),
    },
  }),
  clearNotes: procedure({
    input: sessionKeySchema,
    output: notesStateSchema,
  }),
});
```

See [../../examples/api-definition/contract.ts](../../examples/api-definition/contract.ts).

## Endpoint Kinds

### `procedure`

`procedure({ input, output })` defines a request/response call. Procedure clients
accept an optional `{ signal }` call option for cooperative cancellation; see
[serving](./serving.md#cancellation).

### `fallible`

`fallible({ input, data, error })` defines a procedure whose output is a
`Result<data, error>` payload:

```ts
loadNote: fallible({
  input: z.object({ id: z.string() }),
  data: noteSchema,
  error: z.object({ type: z.literal('note_not_found') }),
});
```

Use `fallible()` for expected domain failures that callers should handle as data.
Thrown `WireError`s are reserved for infrastructure failures and bugs such as
disconnects, unknown paths, and uncaught handler exceptions. See
[wire errors](./errors.md).

### `mutation`

`mutation({ input, data, error }, handler?)` defines a live-model mutation shape.
Top-level mutation endpoints are bound through `bindContract()` implementations.
Group mutations usually provide the inline handler in the contract because
`OptimisticLiveModelGroup` can run the same pure handler on the client.

`mutation()` is for operations that must settle live model cursors. Use
`procedure()` for calls that do not update live models and `job()` for
long-running work.

### `liveModel`

`liveModel({ key, data })` declares a keyed live model endpoint. If `key` is
omitted, the endpoint uses an optional void key. The endpoint id is assigned from
the contract path:

```ts
notes: liveModel({ data: notesStateSchema });
// notesApi.session.models.notes.id === 'session.notes'
```

### `liveLog`

`liveLog({ key })` declares a keyed text log endpoint. It is served by a
`LiveLogServer` resolver and bound on the client with `onReset`/`onAppend`
callbacks.

### `job`

`job({ input, progress, result, error })` models long-running work with progress,
cancellation, terminal state, and reattach:

```ts
build: job({
  input: z.object({ target: z.string() }),
  progress: z.object({ step: z.string() }),
  result: z.object({ artifact: z.string() }),
  error: z.object({ message: z.string() }),
});
```

`bindContract()` binds the endpoint to `{ run, toError }`. The typed client gets
`start(input)` and `attach(jobId)` helpers. See [live jobs](../live/live-job.md).

### `defineLiveModelContract`

`defineLiveModelContract({ key, models, mutations })` aggregates related live
models and the mutations that may touch them. A single key addresses every
member. Models are declared as data schemas; the helper creates the keyed member
refs.

```ts
const api = defineContract({
  conversation: defineLiveModelContract({
    key: conversationKeySchema,
    models: {
      state: stateSchema,
      usage: usageSchema,
    },
    mutations: {
      setTitle: mutation(
        { input: z.object({ title: z.string() }), data: z.void(), error: z.string() },
        (ctx, input) => {
          ctx.produce('state', (draft) => {
            (draft as { title: string }).title = input.title;
          });
          ctx.produce('usage', (draft) => {
            (draft as { tokens: number }).tokens += input.title.length;
          });
          return ok(undefined);
        }
      ),
    },
  }),
});
```

Inline group mutation handlers should be pure functions of the member drafts and
input: avoid I/O, time, randomness, and server-only state in the inline handler
body. If a mutation is schema-only (`mutation(def)`), the server supplies the
handler when it creates the live model host.

## Nested Composition

Contracts can contain other contracts:

```ts
const ptyAgent = defineContract({
  sessions: liveModel({ key: sessionKeySchema, data: sessionStateSchema }),
  output: liveLog({ key: sessionKeySchema }),
});

const api = defineContract({ ptyAgent });
```

The final mount path determines ids and procedure paths:

- `api.ptyAgent.sessions.id` is `ptyAgent.sessions`.
- `api.ptyAgent.output.id` is `ptyAgent.output`.
- a procedure at `api.ptyAgent.startSession` is called as `ptyAgent.startSession`.
- a group member at `api.tasks.conversation.models.state` gets the id
  `tasks.conversation.state`.

This lets packages define small contracts locally and compose them into a larger
workspace API without an extra namespace argument.

## Group Instances

On the server, create a host for the group contract, then create instances as
keyed resources appear:

```ts
const conversations = createLiveModelHost(api.conversation);
const instance = conversations.create(key, {
  state: { title: 'Initial' },
  usage: { tokens: 0 },
});
```

Then bind the group by passing the host in the implementation object:

```ts
const controller = bindContract(api, { conversation: conversations });
```

The client group binding exposes each member model, each mutation method,
`ready`, and `dispose()`. See [serving](./serving.md#typed-clients).
