# Transports

A `WireTransport` is the protocol boundary:

```ts
type WireTransport = {
  post(message: WireMessage): void;
  onMessage(cb: (message: WireMessage) => void): Unsubscribe;
  onDisconnect(cb: () => void): Unsubscribe;
  onReconnect?(cb: () => void): Unsubscribe;
  close?(): void;
};
```

The same `serve()`, `connect()`, and `client()` code works across every
transport. Only construction changes.

`onReconnect` is optional and should fire only after a replacement link is live.
`connect()` uses it to re-attach live topics; replicas then force a fresh
snapshot. `close()` releases listeners registered by the adapter. It closes the
underlying channel only when the adapter owns a closeable channel, such as a
`MessagePort`.

## Memory

`memoryTransportPair()` creates paired in-process transports for tests and
examples:

```ts
const pair = memoryTransportPair();
serve(pair.right, controller);

const contractClient = client(api, connect(pair.left));
```

`pair.disconnect()` disconnects both sides. Each endpoint also exposes `close()`,
which aliases the pair disconnect for test cleanup.

`left` and `right` are the two ends of one duplex channel, not semantic roles.
Posting on `left` delivers to listeners registered on `right`, and posting on
`right` delivers to listeners registered on `left`. This mirrors
`MessageChannel`'s `port1`/`port2`: tests commonly call `serve(pair.right, ...)`
and `connect(pair.left)`, but the opposite assignment is equally valid.

## Event Ports

`portTransport(port)` adapts Electron-style ports with `postMessage()` and
`on('message')`:

```ts
const transport = portTransport(messagePortMain);
serve(transport, controller);
```

The adapter listens for `close`, `exit`, and `error` as disconnect signals.
`close()` removes the message and lifecycle listeners it registered and calls
`port.close?.()`.

## DOM MessagePort

`domPortTransport(port)` adapts browser `MessagePort` objects:

```ts
const channel = new MessageChannel();
serve(domPortTransport(channel.port1), controller);

const connection = connect(domPortTransport(channel.port2));
```

The adapter calls `port.start?.()` and listens for `message` and `close` events.
`close()` removes those listeners and calls `port.close?.()`.

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
const contractClient = client(api, connect(domPortTransport(port as MessagePort)));
```

Opening a new port for the same `webContents.id` closes the old one. Naturally
closed ports are removed from the session map. Internally, the helper uses
`createWireSessionHub(controller)`, so session teardown also closes the transport.

## Node Streams

`streamTransport(input, output)` frames messages as newline-delimited JSON. It is
useful for subprocess, stdio, and SSH-style boundaries:

```ts
const transport = streamTransport(child.stdout, child.stdin);
const contractClient = client(api, connect(transport));
```

Malformed frames are ignored. `close`, `end`, and `error` on the readable side
trigger disconnect listeners. `close()` stops parsing and clears local listeners;
it does not close the readable or writable streams because those streams are owned
by the caller.

## Reconnecting

`reconnectingTransport(connectOnce, options?)` wraps an async transport factory:

```ts
const transport = reconnectingTransport(
  async () => {
    const pair = await openRemoteWirePair();
    return pair.left;
  },
  { backoffMs: [100, 250, 500, 1000], maxQueuedMessages: 1000 }
);
```

Messages posted while no inner transport is connected are queued. When an inner
transport disconnects, listeners are notified and reconnection starts. The queue
uses the shared bounded-buffer core with drop-oldest semantics;
`maxQueuedMessages` defaults to `1000`. Blob-channel frames are never queued
across reconnects because stale credit, chunks, or close frames cannot be safely
replayed.

`onReconnect` fires after a replacement inner transport is connected and queued
messages are flushed. `Connection` listens for that signal and re-issues active
`attach` requests; replicas refresh their snapshots after reattach.
`close()` stops the retry loop, closes the current inner
transport if present, and clears queued messages and listeners.

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

`reconnectingTransport()` accepts `clock` and `retrySchedule` options. The legacy
`backoffMs` array is normalized to a repeat-last retry schedule. Closing the
transport synchronously aborts pending reconnect sleeps and disposes late
connections.

Electron window exposure returns an async cleanup function. Await it when tearing
down a runtime host so session hubs and controllers finish disposal before the
worker or window bridge is replaced.

`loggingTransport.close()` delegates to the wrapped transport, and
`onReconnect()` is forwarded when the wrapped transport supports it.

Transport composition is ordinary function wrapping, so order matters:

```ts
// Logs the stable outer endpoint, including queued frames and reconnect events.
const outerLogged = loggingTransport(reconnectingTransport(openTransport), logger);

// Logs each concrete inner connection separately.
const innerLogged = reconnectingTransport(async () =>
  loggingTransport(await openTransport(), logger)
);
```

Use transport-level logging when you need frame-level evidence: raw `call`,
`result`, `attach`, `update`, and reconnect traffic. Use controller/client
instrumentation for semantic telemetry: one event per logical call, snapshot,
attachment, cancellation, resync, or mutation dedupe. In practice, apps should
enable instrumentation by default and turn on transport logging only while
debugging a boundary.
