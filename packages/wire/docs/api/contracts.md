# API Contracts

Contracts describe the API surface once. Controller creation and client creation
derive their types from the same object.

## Defining a Contract

Use `defineContract({ ... })`. Object keys are significant: they determine
procedure paths and live ref ids after nested contracts are mounted.

```ts
export const notesApi = defineContract({
  activity: liveLog({ key: sessionKeySchema }),
  session: liveModel({
    key: sessionKeySchema,
    states: {
      notes: liveState({ data: notesStateSchema }),
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

`mutation({ input, data, error }, handler?)` defines a live-state mutation shape.
Mutations are members of `liveModel()` definitions. They usually provide the
inline handler in the contract because
`OptimisticLiveModel` can run the same pure handler on the client.

`mutation()` is for operations that must settle live model cursors. Use
`procedure()` for calls that do not update live models and `liveJob()` for
long-running work.

### `liveLog`

`liveLog({ key })` declares a keyed text log endpoint. It is served by a
`LiveLog` resolver and consumed through a `LiveLogClientHandle` or a
`LiveLogReplica`.

### `liveJob`

`liveJob({ input, progress, result, error })` models long-running work with progress,
cancellation, terminal state, and reattach:

```ts
build: liveJob({
  input: z.object({ target: z.string() }),
  progress: z.object({ step: z.string() }),
  result: z.object({ artifact: z.string() }),
  error: z.object({ message: z.string() }),
});
```

`createController()` binds the endpoint to `{ run, toError? }`. `run` returns a
`Result<result, error>` payload; `toError` is only an optional fallback for
unexpected thrown errors. The typed client gets `start(input)`, `cancel(jobId)`,
and `handle(jobId)` helpers. See
[live jobs](../live/live-job.md).

### `downloadFile` and `uploadFile`

`downloadFile({ input, meta?, error })` and
`uploadFile({ input, accept?, maxSize?, result, error })` model byte transfer as a
typed call envelope plus a credit-based blob channel. Bytes are streamed in
bounded chunks and are not embedded in procedure inputs or results:

```ts
readAttachment: downloadFile({
  input: z.object({ id: z.string() }),
  error: z.object({ type: z.string() }),
});

uploadAttachment: uploadFile({
  input: z.object({ conversationId: z.string() }),
  accept: ['image/png', 'image/jpeg'],
  maxSize: 25 * 1024 * 1024,
  result: attachmentRefSchema,
  error: z.object({ type: z.string() }),
});
```

Download clients receive a single-use handle with `chunks()`, `bytes()`, `file()`,
and `cancel()`. Upload clients pass a file-like value as the second argument. See
[file endpoints](./files.md).

### `liveModel`

`liveModel({ key, states, mutations })` aggregates related live states and the
mutations that may touch them. A single key addresses every member. States are
declared with `liveState({ data })`; the helper creates keyed member refs.

```ts
const api = defineContract({
  conversation: liveModel({
    key: conversationKeySchema,
    states: {
      state: liveState({ data: stateSchema }),
      usage: liveState({ data: usageSchema }),
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
  sessions: liveModel({
    key: sessionKeySchema,
    states: { state: liveState({ data: sessionStateSchema }) },
  }),
  output: liveLog({ key: sessionKeySchema }),
});

const api = defineContract({ ptyAgent });
```

The final mount path determines ids and procedure paths:

- `api.ptyAgent.sessions.states.state.id` is `ptyAgent.sessions.state`.
- `api.ptyAgent.output.id` is `ptyAgent.output`.
- a procedure at `api.ptyAgent.startSession` is called as `ptyAgent.startSession`.
- a group member at `api.tasks.conversation.states.state` gets the id
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

Then expose the group by passing the host in the implementation object:

```ts
const controller = createController(api, { conversation: conversations });
```

The live model client handle exposes `state(key, name)` for member handles and
`mutate(name, envelope)` for mutation calls. Wrap it in `createLiveModelReplica()`
when a process wants local state, ref counting, and mutation settling. See
[serving](./serving.md#typed-clients).
