# ProcessHost

`ProcessHost` is a small process supervision abstraction exported from
`@emdash/wire/process`.

It is split into two layers:

- The process core is environment-agnostic: types, restart supervision,
  `utilityProcessHost()`, and `processTransport()`.
- The Node implementation lives in `@emdash/wire/process/node` because it
  imports `node:child_process`.

The same core can later host other process-like boundaries, such as WebWorkers,
by adapting them to the `ChildHandle` shape.

## Types

```ts
type ProcessSpec = {
  entry: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  supervision?:
    | { restart: 'never' }
    | {
        restart: 'on-failure';
        backoffMs?: number[];
        maxRestarts?: number;
      };
  gracefulShutdown?: { message?: unknown; graceMs: number };
};
```

`ProcessHost.spawn(spec, scope?)` returns a stable `ManagedProcess` handle:

```ts
const runtime = await host.spawn(spec, scope);

runtime.send({ kind: 'ping' });
runtime.onMessage((message) => console.log(message));
runtime.onExit((exit) => console.log(exit.willRestart));

await runtime.dispose();
```

The handle stays valid across supervised restarts. Internally, `send()` and
subscriptions retarget the current child.

Use `listen(emitter, event, cb)` when adapting event-emitter-like process APIs.
It accepts emitters with `on()` plus either `off()` or `removeListener()`, and
returns an `Unsubscribe`.

## Node Child Processes

Use `childProcessHost()` from the Node subpath:

```ts
import { childProcessHost } from '@emdash/wire/process/node';
import { createScope } from '@emdash/wire/util';

const scope = createScope({ label: 'runtime' });
const host = childProcessHost();

const process = await host.spawn(
  {
    entry: '/path/to/runtime.js',
    supervision: { restart: 'on-failure', backoffMs: [100, 500], maxRestarts: 3 },
  },
  scope
);
```

The child is forked with an IPC channel and piped stdout/stderr. `dispose()`
kills the child and suppresses restarts.

## Electron Utility Processes

Use `utilityProcessHost()` when the caller can provide an injected Electron
`utilityProcess.fork`-like function:

```ts
import { utilityProcessHost } from '@emdash/wire/process';

const host = utilityProcessHost({
  fork: (entry, args, options) => utilityProcess.fork(entry, args, options),
});
```

The host uses structural types and does not import `electron`.

## Serving Wire over a Process

`processTransport(process)` adapts a `ManagedProcess` to `WireTransport`:

```ts
import { client, connect } from '@emdash/wire';
import { processTransport } from '@emdash/wire/process';

const runtime = await host.spawn({ entry: '/path/to/runtime.js' }, scope);
const thin = client(api, connect(processTransport(runtime)));
```

The child runtime must serve a controller over its IPC messages:

```ts
const transport: WireTransport = {
  post: (message) => process.send?.(message),
  onMessage: (cb) => {
    const listener = (message: unknown) => {
      if (isWireMessage(message)) cb(message);
    };
    process.on('message', listener);
    return () => process.off('message', listener);
  },
  onDisconnect: (cb) => {
    process.on('disconnect', cb);
    return () => process.off('disconnect', cb);
  },
};

serve(transport, controller);
```

## Supervision

When `supervision.restart` is `'on-failure'`, non-zero exits and signal exits
schedule a respawn using `backoffMs`. Clean exits do not restart. After
`maxRestarts`, the process stays stopped and `onExit()` receives
`willRestart: false`.

For graceful shutdown, pass a shutdown message and grace window:

```ts
await host.spawn({
  entry: '/path/to/runtime.js',
  gracefulShutdown: { message: { kind: 'shutdown' }, graceMs: 1_000 },
});
```

On dispose, the host sends the message, waits up to `graceMs`, then hard-kills if
the child is still running.

See [../../examples/process/client.ts](../../examples/process/client.ts).
