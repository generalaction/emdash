# Replicas

Replicas are consumer-instantiated materialization wrappers around client handles from
`client()`. The typed client itself never stores live state. A consumer chooses
one of four shapes:

- Own state: `LiveState`, `LiveLog`, `LiveJob`, or `LiveModelHost`.
- Stream directly: use a client `snapshot()`/`attach()` handle with no local store,
  for example PTY output written straight into xterm.
- Forward: pass client handles or subtrees to `bindContract()` so a hop stays stateless.
- Replica: wrap a client handle to hold local state, share upstream subscriptions, and
  serve downstream clients.

Every replica manager has the same lifecycle shape:

```ts
const lease = replica.acquire(key);
const instance = await lease.ready();
await lease.release();
await replica.dispose();
```

`acquire()` increments the ref count for that key. The first lease opens the
upstream subscription, concurrent leases share it, and the last release starts
the optional `retentionMs` timer. `peek(key)` returns a warm instance while it is
retained.

## Model Replicas

Live models are exposed only through `liveModel()`. A
`LiveModelReplica` follows a live model client handle and yields a `ReplicaInstance`:

```ts
const conversations = createLiveModelReplica(api.conversation, contractClient.conversation, {
  retentionMs: 30_000,
  store: (stateName) => createMobxStore(stateName),
  onChange: {
    state: (value, meta) => console.log(value, meta.kind),
  },
});

const lease = conversations.acquire({ conversationId: 'demo' });
const conversation = await lease.ready();

const updated = await conversation.mutations.setTitle({ title: 'Replicated' });
await updated.settled;
console.log(conversation.states.state.current());
```

`ReplicaInstance.states` contains one `ReplicaState` per contract member.
`ReplicaState` follows upstream snapshots and updates, stores current state in a
pluggable `StateStore`, and re-emits updates in a replica-local cursor space.

Mutation helpers return `{ result, settled }`. On success, the replica translates
upstream cursors to local cursors before returning them to downstream clients, so
both local UI and served clients settle against the same local state.

## Log Replicas

Use a `LiveLogReplica` when a process needs a local retained text buffer or wants
to serve log output downstream:

```ts
const outputs = createLiveLogReplica(api.ptyOutput, contractClient.ptyOutput, {
  retentionMs: 10_000,
  maxBufferBytes: 1024 * 1024,
});

const lease = outputs.acquire({ sessionId });
const output = await lease.ready();
output.onAppend((chunk) => index(chunk));
console.log(output.text());
```

For terminal rendering, prefer the client handle directly:

```ts
const output = contractClient.ptyOutput.handle({ sessionId });
term.write((await output.snapshot()).data.text);
const detach = await output.attach((update) => {
  term.write((update.delta as { chunk: string }).chunk);
});
```

## Job Replicas

`LiveJobReplica` wraps a live job client handle. It forwards `start()` and `cancel()`,
materializes job state by `jobId`, and keeps terminal state readable under lease
or retention:

```ts
const jobs = createLiveJobReplica(api.build, contractClient.build, { retentionMs: 30_000 });

const lease = await jobs.start({ target: 'desktop' });
const job = await lease.ready();
job.onProgress((progress) => console.log(progress.step));
console.log(await job.result);

await lease.release();

const late = jobs.acquire(job.jobId);
console.log((await late.ready()).getState());
```

When a job reaches `succeeded`, `failed`, or `cancelled`, the replica detaches
from the upstream live topic but retains the local terminal state while leases or
`retentionMs` keep it warm.

## Serving Replicas

Replicas bind directly into `bindContract()`:

```ts
const upstream = client(api, connect(sshTransport));

const controller = bindContract(api, {
  conversation: createLiveModelReplica(api.conversation, upstream.conversation),
  ptyOutput: upstream.ptyOutput, // forward bytes without buffering
  build: createLiveJobReplica(api.build, upstream.build),
});
```

Use replicas only when the hop needs local state. If the hop is a pure relay,
forward the client subtree instead.
