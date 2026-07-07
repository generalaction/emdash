# Contracts

Contracts describe the API surface once, then server binding and client creation
derive their types from that definition.

## Defining a Contract

Use `defineContract({ ... })`. Object keys are significant: they determine
procedure paths and live ref ids.

```ts
export const notesApi = defineContract({
  notes: liveModel({ key: sessionKeySchema, data: notesStateSchema }),
  activity: liveLog({ key: sessionKeySchema }),
  addNote: mutation({
    input: sessionKeySchema.extend({ text: z.string() }),
    data: noteSchema,
    error: z.string(),
  }),
  clearNotes: procedure({
    input: sessionKeySchema,
    output: notesStateSchema,
  }),
});
```

See [../examples/api-definition/contract.ts](../examples/api-definition/contract.ts).

## Endpoint Kinds

### `procedure`

Procedures are request/response calls. They do not settle live model updates
automatically. Procedure clients accept an optional `{ signal }` call option for
cooperative cancellation; see [Cancellation](./cancellation.md).

```ts
clearNotes: procedure({
  input: sessionKeySchema,
  output: notesStateSchema,
});
```

### `liveModel`

Live model endpoints expose `LiveModelServer` instances over a key. The endpoint
id is assigned from the contract path:

```ts
notes: liveModel({ key: sessionKeySchema, data: notesStateSchema });
// notesApi.notes.id === 'notes'
```

### `liveLog`

Live log endpoints expose `LiveLogServer` instances:

```ts
activity: liveLog({ key: sessionKeySchema });
// notesApi.activity.id === 'activity'
```

### `job`

Jobs model long-running work with progress, cancellation, terminal state, and
reattach. A job endpoint is declared once:

```ts
build: job({
  input: z.object({ target: z.string() }),
  progress: z.object({ step: z.string() }),
  result: z.object({ artifact: z.string() }),
  error: z.object({ message: z.string() }),
});
```

`bindContract()` binds the endpoint to `{ run, toError }`. The client gets
`start(input)` and `attach(jobId)` helpers. See [Live jobs](./live-job.md) and
[../examples/job-contract/client.ts](../examples/job-contract/client.ts).

### Top-level `mutation`

Top-level mutations are declared in the contract, but their handlers are bound
on the server in `bindContract()`:

```ts
addNote: mutation({
  input: sessionKeySchema.extend({ text: z.string() }),
  data: noteSchema,
  error: z.string(),
});
```

Do not pass an inline handler to a top-level mutation. `defineContract()` rejects
that because top-level mutation handlers need server-only access to registries
and services.

### `liveModelGroup`

Groups aggregate related live models and the mutations that may touch them. A
single key addresses every member:

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

Group mutations must have inline handlers. The same handler runs on the server,
and `OptimisticLiveModelGroup` may run it on the client to derive optimistic
previews. Keep group handlers pure functions of `(member drafts, input)`: avoid
I/O, time, random numbers, and server-only state in the handler body.

See [../examples/group/client.ts](../examples/group/client.ts).

## Nested Composition

Contracts can contain contracts:

```ts
const ptyAgent = defineContract({
  sessions: liveModel({ key: sessionKeySchema, data: sessionStateSchema }),
  output: liveLog({ key: sessionKeySchema }),
});

const api = defineContract({
  ptyAgent,
});
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

On the server, create and register a group instance:

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

The group binding exposes each member model plus each mutation method.
