# Replicas

Replicas are consumer-instantiated materialization wrappers around client handles from
`client()`. The typed client itself never stores live state. A consumer chooses
one of four shapes:

- Own state: `LiveState`, `LiveLog`, `LiveJob`, or `LiveModelHost`.
- Stream directly: use a client `snapshot()`/`attach()` handle with no local store,
  for example PTY output written straight into xterm.
- Forward: pass client handles or subtrees to `createController()` so a hop stays stateless.
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
import { createMobxStore } from '@emdash/wire/util/mobx';

const conversations = createLiveModelReplica(api.conversation, contractClient.conversation, {
  retentionMs: 30_000,
  store: () => createMobxStore(),
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
MobX consumers can pass `createMobxStore()` from `@emdash/wire/util/mobx` to
make `current()` reads observable inside computeds and reactions.

Mutation helpers return `{ result, settled }`. On success, the replica translates
upstream cursors to local cursors before returning them to downstream clients, so
both local UI and served clients settle against the same local state.

## Log Replicas

Use a `LiveLogReplica` when a process needs a local retained text buffer or wants
to serve log output downstream:

```ts
import { createMobxLogStore } from '@emdash/wire/util/mobx';

const outputs = createLiveLogReplica(api.ptyOutput, contractClient.ptyOutput, {
  retentionMs: 10_000,
  maxBufferBytes: 1024 * 1024,
  store: () => createMobxLogStore(),
});

const lease = outputs.acquire({ sessionId });
const output = await lease.ready();
output.onAppend((chunk) => index(chunk));
console.log(output.text());
```

The log replica keeps its internal `LiveLog` buffer for downstream serving, and
optionally writes the retained text through to a pluggable `LogStore`.

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
import { createMobxStore } from '@emdash/wire/util/mobx';

const jobs = createLiveJobReplica(api.build, contractClient.build, {
  retentionMs: 30_000,
  store: () => createMobxStore(),
});

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
The job replica also supports a pluggable `StateStore`, so `getState()` can be
observable while the internal `LiveState` continues to serve downstream clients.

## Serving Replicas

Replicas can be passed directly into `createController()`:

```ts
const upstream = client(api, connect(sshTransport));

const controller = createController(api, {
  conversation: createLiveModelReplica(api.conversation, upstream.conversation),
  ptyOutput: upstream.ptyOutput, // forward bytes without buffering
  build: createLiveJobReplica(api.build, upstream.build),
});
```

Use replicas only when the hop needs local state. If the hop is a pure relay,
forward the client subtree instead.
