# API Contracts

Contracts describe the API surface once. Server binding and client creation
derive their types from the same object.

## Defining a Contract

Use `defineContract({ ... })`. Object keys are significant: they determine
procedure paths and live ref ids after nested contracts are mounted.

```ts
export const notesApi = defineContract({
  activity: liveLog({ key: sessionKeySchema }),
  session: liveModelGroup({
    key: sessionKeySchema,
    models: {
      notes: liveModel({ data: notesStateSchema }),
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

### `liveModelGroup`

`liveModelGroup({ key, models, mutations })` aggregates related live models and
the mutations that may touch them. A single key addresses every member:

```ts
const api = defineContract({
  conversation: liveModelGroup({
    key: conversationKeySchema,
    models: {
      state: liveModel({ data: stateSchema }),
      usage: liveModel({ data: usageSchema }),
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

Group mutation handlers should be pure functions of the member drafts and input:
avoid I/O, time, randomness, and server-only state in the inline handler body.

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

On the server, create and register a group instance when a keyed resource is
created:

```ts
const registry = new LiveModelRegistry();
const instance = createGroupInstance(api.conversation, key, {
  state: { title: 'Initial' },
  usage: { tokens: 0 },
});

registry.registerGroup(api.conversation, key, instance);
```

Then bind the group through the registry:

```ts
const controller = bindContract(api, {
  registry,
  impl: { conversation: fromRegistry() },
});
```

The client group binding exposes each member model, each mutation method,
`ready`, and `dispose()`. See [serving](./serving.md#typed-clients).
