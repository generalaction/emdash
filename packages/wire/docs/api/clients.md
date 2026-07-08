# Typed Clients

`client(contract, connection)` creates a thin, typed protocol client. It has the
same nested shape as the contract, but it does not materialize live state.

Think of it as a type-safe wrapper around `Connection`: it knows contract paths,
input/output types, live topic ids, group keys, and mutation envelopes, but it does
not keep snapshots, apply patches, or settle mutations against local state.

```ts
const thin = client(api, connect(transport));

await thin.ping({ message: 'hello' });

const state = thin.conversation.model(key, 'state');
const snapshot = await state.snapshot();
const detach = await state.attach((update) => {
  console.log(update.delta);
});
```

## Endpoint Shapes

Each contract endpoint becomes a thin protocol shape:

- Procedures become typed functions: `thin.ping(input, { signal? })`.
- Live logs become refs: `thin.output.handle(key)`.
- Live model groups become group refs: `thin.conversation.model(key, 'state')`
  and `thin.conversation.mutate('setTitle', envelope)`.
- Jobs become job refs: `thin.build.start(input)`, `thin.build.cancel(jobId)`,
  and `thin.build.handle(jobId)`.

`ThinLiveHandle` is the common live handle:

```ts
type ThinLiveHandle<T> = {
  topic: string;
  snapshot(): Promise<LiveSnapshot<T>>;
  attach(push: (update: LiveUpdate) => void, options?: { onReattach?: () => void }): Promise<Unsubscribe>;
  asLiveSource(): LiveSource;
};
```

`snapshot()` and `attach()` are useful for low-level code. For example, PTY output
can stream directly into an xterm instance without allocating another store:

```ts
const output = thin.ptyOutput.handle({ sessionId });
term.write((await output.snapshot()).data.text);

const detach = await output.attach((update) => {
  term.write((update.delta as { chunk: string }).chunk);
}, {
  onReattach: async () => {
    term.reset();
    term.write((await output.snapshot()).data.text);
  },
});
```

When a process wants local state, pass the thin ref to a replica wrapper instead.

## Forwarding

Thin clients are intentionally forwardable. A procedure method can be passed to
`bindContract()` as a procedure implementation, and a thin live model group can be
passed as the group implementation:

```ts
const upstream = client(api, connect(sshTransport));

const controller = bindContract(api, {
  ping: upstream.ping,
  conversation: upstream.conversation,
});
```

No live state is created at that hop. The downstream client sees the same contract,
while calls, snapshots, live attachments, jobs, and group mutations are forwarded to
the upstream connection.

This is the right shape for protocol relays and middle tiers that should not own or
cache state. The hop does not create `ReplicaModel`s, does not allocate local
cursor spaces, and does not run mutation settling. It just preserves the contract
surface while delegating to the upstream connection.

Forwarding also works selectively:

```ts
const upstream = client(workspaceApi, connect(sshTransport));

const controller = bindContract(workspaceApi, {
  // Local interception.
  ping: async () => 'desktop-main',

  // Forwarded subtree.
  git: upstream.git,

  // Cached group; see Replicas.
  conversation: createLiveModelReplica(
    workspaceApi.conversation,
    upstream.conversation,
    { retentionMs: 10 * 60_000 }
  ),
});
```

`relayController(connection)` still exists for contract-less passthrough. Prefer
thin-client forwarding when the hop knows the contract, because `bindContract()` can
keep the implementation typed and can mix local handlers with forwarded subtrees.

## When to Use Replicas

Use replicas when a process wants local state. See [Replicas](../live/replicas.md).

Common examples:

- A renderer window wants observable UI state.
- Electron main wants state that survives renderer reloads.
- A process wants a local cache before serving the same live model contract to
  downstream clients.

For Electron main and other middle tiers that both serve and inspect live state, use
the replica local access pattern in
[Replicas](../live/replicas.md#model-replicas).

Do not materialize just to forward. Forward the thin ref or subtree directly.
