# Process Runtimes

`spawnRuntime()` and `serveWorkerProcess()` pair a `ProcessHost` with the wire
API layer so a bound controller can run in a subprocess with one call on each
side. They are exported from `@emdash/wire/util/process-runtime`.

For application workers, prefer the higher-level parent-side helpers documented
in [Workers](./workers.md). They add entry resolution, default supervision,
scope-owned lifecycle logs, and lazy spawning while keeping child-side wire setup
explicit.

Use this pattern when a child process can recreate its authoritative state after
a restart and clients can resync through live snapshots.

## Child Side

The child entry file receives a root `Scope`, creates the controller, and
returns it:

```ts
import { createController, createLiveModelHost } from '@emdash/wire';
import { serveWorkerProcess } from '@emdash/wire/util/process-runtime';
import { api } from './contract';

void serveWorkerProcess((scope) => {
  const counters = createLiveModelHost(api.counter);
  const instance = counters.create(undefined, { counter: { count: 0 } });
  scope.add(() => console.log('runtime scope disposed'));

  return createController(api, {
    increment: () => {
      instance.states.counter.produce((draft) => {
        draft.count += 1;
      });
      return instance.states.counter.snapshot().data.count;
    },
    counter: counters,
  });
});
```

`serveWorkerProcess()`:

- Detects the parent channel: Node `fork()` IPC or Electron utility-process
  `parentPort`.
- Serves wire messages over that channel while ignoring non-wire runtime
  signals.
- Sends a `ready` signal after the controller is served.
- Disposes the root scope on the runtime shutdown signal or parent disconnect,
  then exits.
- Logs startup failures and exits with code 1 through the provided `exit` seam.

Register all child resources on the supplied scope. It is the only shutdown path
for graceful runtime disposal.

## Parent Side

The parent supplies a `ProcessHost`, contract, and process spec:

```ts
import { spawnRuntime } from '@emdash/wire/util/process-runtime';
import { childProcessHost } from '@emdash/wire/process/node';
import { createScope } from '@emdash/wire/util';
import { api } from './contract';

const scope = createScope({ label: 'counter-runtime' });
const runtime = await spawnRuntime({
  host: childProcessHost(),
  contract: api,
  spec: {
    entry: '/absolute/path/to/runtime.js',
    supervision: { restart: 'on-failure', backoffMs: [100, 500], maxRestarts: 3 },
  },
  scope,
});

await runtime.client.increment(undefined);
await scope.dispose();
```

`spawnRuntime()` waits until the child sends its `ready` signal. If the child
exits before it is ready or no ready signal arrives before `readyTimeoutMs`
(default 10 seconds), the managed process is disposed and the spawn rejects.

Unless the caller provides `spec.gracefulShutdown`, `spawnRuntime()` installs the
runtime shutdown signal with a 1 second grace window. On disposal, the
`ProcessHost` sends that signal, waits for the child to dispose its scope and
exit, then escalates according to the host's process-kill behavior.

## Restarts

The returned `client` and `connection` are stable across supervised restarts.
When a restarted child sends `ready`, `spawnRuntime()` maps that signal to
`WireTransport.onReconnect`. `connect()` then re-establishes existing live
attachments, so `ReplicaState`, `LiveModelReplica`, `LiveLogReplica`, and
`LiveJobReplica` instances can resync from fresh snapshots without rebuilding
the client.

```ts
const counter = new ReplicaState(runtime.client.counter.state(undefined, 'counter'));
await counter.ready;

runtime.onRestarted(() => {
  console.log('runtime restarted and live attachments reconnected');
});
```

Calls that were in flight during a crash reject with `DISCONNECTED`. Retrying
procedures is a caller decision because only the caller knows whether the
operation is idempotent. Live model mutations already have retry support through
their mutation IDs.

## When Not To Use It

This helper assumes a restarted child can rebuild from durable or derivable
state and serve fresh snapshots. That fits process-isolated wire runtimes well.

Do not use automatic process-runtime restart as the only recovery layer for
protocol sessions that need semantic resumption, such as ACP agents or PTY
conversations. For those runtimes, spawn the process with `restart: 'never'` and
let the ACP or PTY session supervisor decide when and how to resume, replay, or
discard session state.

## Example

See [../../examples/process/client.ts](../../examples/process/client.ts) and
[../../examples/process/runtime.ts](../../examples/process/runtime.ts).
