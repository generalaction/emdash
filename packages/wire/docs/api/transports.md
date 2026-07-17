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

`streamTransport(input, output)` uses length-prefixed binary frames. Ordinary
messages contain JSON, while `blob-chunk` messages keep their bytes in a raw
binary body. It is useful for subprocess, stdio, and SSH-style boundaries:

```ts
const transport = streamTransport(child.stdout, child.stdin);
const contractClient = client(api, connect(transport));
```

Frames may be split across chunks or coalesced into one chunk. Invalid JSON,
unknown frame kinds, and frames over the 16 MiB default limit disconnect the
transport; well-formed messages that are not part of the Wire protocol are
ignored. `close`, `end`, and `error` on the readable side also trigger disconnect
listeners. `close()` stops parsing and clears local listeners; it does not close
the readable or writable streams because those streams are owned by the caller.

## WebSockets

`webSocketTransport(socket, options?)` adapts both browser `WebSocket` objects and
Node `ws`-style sockets without importing either implementation. The adapter uses
the same length-prefixed JSON/binary codec as `streamTransport`, so blob chunks
remain binary and no base64 conversion is needed:

```ts
const socket = new WebSocket('wss://example.test/wire');
const transport = webSocketTransport(socket);
await transport.ready;
const contractClient = client(api, connect(transport));
```

`browserWebSocketTransport()` and `nodeWebSocketTransport()` provide narrower
structural types when an integration wants to state which event API it expects.
Browser sockets are switched to `binaryType = 'arraybuffer'`; Blob-like values,
ArrayBuffers, typed-array views, Node Buffers, and fragmented Node payloads are
accepted on receive. Text messages are rejected. `close` and `error` notify
disconnect listeners exactly once. Malformed or oversized frames close the socket
with WebSocket protocol-error code `1002`. `maxFrameBytes` can lower the shared
codec's 16 MiB default for an internet-facing boundary.

For clients that should reconnect, use the WebSocket-specific convenience wrapper:

```ts
const transport = reconnectingWebSocketTransport(
  () => new WebSocket('wss://example.test/wire'),
  {
    backoffMs: [100, 250, 500, 1000, 2000],
    maxQueuedMessages: 1000,
    maxFrameBytes: 128 * 1024,
  }
);
const contractClient = client(api, connect(transport));
```

It waits for each socket's `open` event before handing it to the standard
`reconnectingTransport`. Calls posted while offline use the same bounded queue.
When that queue is full, `post()` throws without discarding earlier messages, so
the rejected call cannot remain pending indefinitely. Blob-channel frames are
never replayed because their credit and sequence state belongs to the disconnected
socket. `onReconnect` fires after a replacement socket is open and queued messages
have flushed.

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
is bounded; `maxQueuedMessages` defaults to `1000`. Posting another non-blob
message when it is full throws synchronously and preserves the messages already
queued.

`onReconnect` fires after a replacement inner transport is connected and queued
messages are flushed. `Connection` listens for that signal and re-issues active
`attach` requests; replicas refresh their snapshots after reattach.
`close()` stops the retry loop, closes the current inner
transport if present, and clears queued messages and listeners.

## Process Transport

`processTransport(process)` adapts a supervised `ManagedProcess` to
`WireTransport`:

```ts
const runtime = await host.spawn({ entry: '/path/to/runtime.js' }, scope);
const contractClient = client(api, connect(processTransport(runtime)));
```

See [process host](../runtime/process-host.md).

`close()` releases `ManagedProcess` message and exit subscriptions. It does not
kill the process; process lifetime remains owned by the `ProcessHost`/`Scope`.

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
