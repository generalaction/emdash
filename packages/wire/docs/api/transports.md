# Transports

A `WireTransport` is the protocol boundary:

```ts
type WireTransport = {
  post(message: WireMessage): void;
  onMessage(cb: (message: WireMessage) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
};
```

The same `serve()`, `connect()`, and `contractClient()` code works across every
transport. Only construction changes.

## Memory

`memoryTransportPair()` creates paired in-process transports for tests and
examples:

```ts
const pair = memoryTransportPair();
serve(pair.right, controller);

const client = contractClient(api, connect(pair.left));
```

`pair.disconnect()` disconnects both sides.

## Event Ports

`portTransport(port)` adapts Electron-style ports with `postMessage()` and
`on('message')`:

```ts
const transport = portTransport(messagePortMain);
serve(transport, controller);
```

The adapter listens for `close`, `exit`, and `error` as disconnect signals.

## DOM MessagePort

`domPortTransport(port)` adapts browser `MessagePort` objects:

```ts
const channel = new MessageChannel();
serve(domPortTransport(channel.port1), controller);

const connection = connect(domPortTransport(channel.port2));
```

The adapter calls `port.start?.()` and listens for `message` and `close` events.

## Electron Windows

`exposeWireToWindows()` serves one controller to many Electron renderer windows
using `MessageChannelMain`-style ports:

```ts
const stop = exposeWireToWindows(
  {
    ipcMain,
    createMessageChannel: () => new MessageChannelMain(),
  },
  controller,
  { channel: 'wire' }
);
```

The renderer asks for a port, then waits for the browser-side transfer:

```ts
await requestWirePort({ ipcRenderer, window }, { channel: 'wire' });
const port = await awaitWirePort(window, { channel: 'wire' });
const client = contractClient(api, connect(domPortTransport(port as MessagePort)));
```

Opening a new port for the same `webContents.id` closes the old one. Internally,
the helper uses `createWireSessionHub(controller)`.

## Node Streams

`streamTransport(input, output)` frames messages as newline-delimited JSON. It is
useful for subprocess, stdio, and SSH-style boundaries:

```ts
const transport = streamTransport(child.stdout, child.stdin);
const client = contractClient(api, connect(transport));
```

Malformed frames are ignored. `close`, `end`, and `error` on the readable side
trigger disconnect listeners.

## Reconnecting

`reconnectingTransport(connectOnce, options?)` wraps an async transport factory:

```ts
const transport = reconnectingTransport(
  async () => {
    const pair = await openRemoteWirePair();
    return pair.left;
  },
  { backoffMs: [100, 250, 500, 1000] }
);
```

Messages posted while no inner transport is connected are queued. When an inner
transport disconnects, listeners are notified and reconnection starts. Existing
`Connection` attachments re-request their `attach` messages after disconnect.

## Process Transport

`processTransport(process)` adapts a supervised `ManagedProcess` to
`WireTransport`:

```ts
const runtime = await host.spawn({ entry: '/path/to/runtime.js' }, scope);
const client = contractClient(api, connect(processTransport(runtime)));
```

See [process host](../runtime/process-host.md).

## Logging Transport

`loggingTransport(transport, logger, options?)` wraps any transport and debug
logs every sent and received protocol message:

```ts
const transport = loggingTransport(pair.right, logger.child({ side: 'server' }), {
  payloads: true,
  maxPayloadLength: 4096,
});
```

Use it for local debugging and integration diagnostics. For semantic request
events, prefer instrumentation and `withLogging()`; see
[observability](../observability.md).
