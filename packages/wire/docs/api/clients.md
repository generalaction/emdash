# Typed Clients

`client(contract, connection)` creates a typed `ContractClient`. It has the
same nested shape as the contract, but it does not materialize live state.

Think of it as a type-safe wrapper around `Connection`: it knows contract paths,
input/output types, live topic ids, group keys, and mutation envelopes, but it does
not keep snapshots, apply patches, or settle mutations against local state.

```ts
const contractClient = client(api, connect(transport));

await contractClient.ping({ message: 'hello' });

const state = contractClient.conversation.state(key, 'state');
const snapshot = await state.snapshot();
const detach = await state.attach((update) => {
  console.log(update.delta);
});
```

## Endpoint Shapes

Each contract endpoint becomes a protocol client handle:

- Procedures become typed functions: `contractClient.ping(input, { signal? })`.
- Live logs become `LiveLogClientHandle`s: `contractClient.output.handle(key)`.
- Live models become `LiveModelClientHandle`s:
  `contractClient.conversation.state(key, 'state')` and
  `contractClient.conversation.mutate('setTitle', envelope)`.
- Jobs become `LiveJobClientHandle`s: `contractClient.build.start(input)`,
  `contractClient.build.cancel(jobId)`, and `contractClient.build.handle(jobId)`.

`LiveClientHandle` is the common live handle:

```ts
type LiveClientHandle<T> = {
  topic: string;
  snapshot(): Promise<LiveSnapshot<T>>;
  attach(push: (update: LiveUpdate) => void, options?: { onReattach?: () => void }): Promise<Unsubscribe>;
  asLiveSource(): LiveSource;
};
```

`snapshot()` and `attach()` are useful for low-level code. For example, PTY output
can stream directly into an xterm instance without allocating another store:

```ts
const output = contractClient.ptyOutput.handle({ sessionId });
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

When a process wants local state, pass the client handle to a replica wrapper instead.

## Forwarding

Contract clients are intentionally forwardable. A procedure method can be passed
to `bindContract()` as a procedure implementation, and a live model client handle
can be passed as the group implementation:

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
cache state. The hop does not create `ReplicaState`s, does not allocate local
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
contract-client forwarding when the hop knows the contract, because `bindContract()`
can keep the implementation typed and can mix local handlers with forwarded subtrees.

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

Do not materialize just to forward. Forward the client handle or subtree directly.
