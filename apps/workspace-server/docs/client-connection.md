# Workspace Server Client Connection

This document describes the target desktop-to-workspace-server connection model.
Only macOS and Linux remotes are in scope for this design.

## Topology

```mermaid
flowchart LR
  subgraph desktop [Desktop Main Process]
    source["ResourceCache per connectionId"]
    reconnecting[reconnectingTransport]
    sshManager[SshConnectionManager]
    proxy[SshClientProxy]
  end
  subgraph remote [Remote Host]
    socket["Unix socket ~/.emdash/workspace-server/run/workspace.sock"]
    hub[createWireSessionHub]
    controller[workspaceWireContract controller]
    acpRuntime["ACP runtime child process"]
  end
  source --> reconnecting
  reconnecting --> sshManager
  sshManager --> proxy
  proxy -->|"openssh_forwardOutStreamLocal"| socket
  socket --> hub
  hub --> controller
  controller -->|"acp domain"| acpRuntime
```

The workspace server daemon listens on a Unix domain socket. The socket lives in
a user-owned directory with mode `0700`; SSH authentication plus filesystem
permissions form the access boundary. Desktop clients do not connect to a TCP
port on the remote host.

`serve --socket` is the daemon serving mode. `serve --stdio` serves the same
wire controller over stdin/stdout and exists as a test and debugging harness.

The daemon also forks an ACP runtime child in socket mode. Desktop clients reach
that runtime through the same workspace wire client at `client.acp.*`; the daemon
forwards `acpApiContract` calls and live-model subscriptions to the child. The
runtime child asks the daemon to resolve provider CLI binaries on the remote host
and then spawns those CLIs locally on that host.

## Desktop Utility Shape

The desktop should expose a resource cache keyed by SSH `connectionId`. Each
lease shares the same underlying workspace connection and keeps it warm for a
short grace window across renderer reloads or transient feature detaches.

```ts
const workspaces = createResourceCache({
  key: (key: { connectionId: string }) => key.connectionId,
  idleTtlMs: 30_000,
  async create({ connectionId }, scope) {
    const transport = reconnectingTransport(async () => {
      const proxy = await sshConnections.connect(connectionId);
      await ensureWorkspaceDaemon(proxy);
      const channel = await proxy.forwardOutStreamLocal(WORKSPACE_SOCKET_PATH);
      return streamTransport(channel, channel);
    });
    scope.add(() => transport.close());

    const connection = connect(transport);
    const workspace = client(workspaceWireContract, connection);
    const initialized = await workspace.initialize({ protocolVersion: PROTOCOL_VERSION });
    if (!initialized.success) {
      throw new WorkspaceProtocolError(initialized.error);
    }
    return { client: workspace, connection };
  },
});
```

`ensureWorkspaceDaemon()` is a future desktop bootstrap step. It should call the
server-side lifecycle CLI to probe the socket, start the daemon if absent, and
leave version upgrades to the wire update flow. After the daemon exists, each
`connectOnce` opens a streamlocal channel with
`SshClientProxy.forwardOutStreamLocal(socketPath)` and adapts it with
`streamTransport(channel, channel)`.

## Failure Semantics

- SSH connection drops: the streamlocal channel closes, `streamTransport` emits
  disconnect, and `reconnectingTransport` retries `connectOnce`.
- SSH reconnects: `SshConnectionManager.connect(connectionId)` reuses or waits
  for the managed SSH connection using the existing credential resolution.
- Workspace daemon restarts: `connectOnce` reopens the Unix socket after the
  daemon starts listening again.
- Live attachments: `connect()` observes `onReconnect` from
  `reconnectingTransport`, re-attaches topics, and replicas resync from fresh
  snapshots.
- Pending calls: in-flight calls reject with `DISCONNECTED`; callers decide
  whether procedure retries are safe. Live model mutations can use mutation IDs
  and retry options.
- Protocol mismatch: `initialize` returns a typed `Result` error with
  `action: 'upgrade-client' | 'upgrade-server'`. The future update flow should
  route `upgrade-server` into workspace-server self-update.

## Server Modes

Socket mode:

```bash
emdash-workspace-server serve --socket
emdash-workspace-server serve --socket ~/.emdash/workspace-server/run/workspace.sock
```

The server ensures the socket directory exists, probes before unlinking stale
socket files, and serves each accepted `net.Socket` through
`createWireSessionHub`.

Daemon lifecycle:

```bash
emdash-workspace-server start
emdash-workspace-server status
emdash-workspace-server stop
```

Lifecycle commands use socket mode by default. They derive sidecar files from
the socket path so custom paths remain self-contained:

```text
~/.emdash/workspace-server/run/workspace.sock
~/.emdash/workspace-server/run/workspace.sock.pid
~/.emdash/workspace-server/run/workspace.sock.lock
~/.emdash/workspace-server/run/workspace.sock.log
~/.emdash/workspace-server/run/acp-attachments/
```

`start` probes the socket first, acquires the lock, spawns `serve --socket` as a
detached process when needed, and waits for `health` to succeed. `stop` reads the
pid file and sends `SIGTERM`, relying on the daemon signal handlers to dispose
the socket server and unlink the socket file. `status` connects to the socket and
calls `health`.

## ACP Session IDs

ACP `startSession` and `resumeSession` return `{ sessionId }` directly to the
desktop client through the workspace wire connection. The desktop side should
persist the returned session id when remote ACP session resume is wired.

Stdio mode:

```bash
emdash-workspace-server serve --stdio
```

Stdio mode must not write logs to stdout because stdout is the wire protocol
channel. It is intended for local integration tests and manual debugging, not as
the production SSH transport.

## Related Docs

- `apps/workspace-server/docs/daemon.md`
- `packages/wire/docs/api/serving.md`
- `packages/wire/docs/api/transports.md`
- `packages/wire/docs/runtime/lifecycle.md`
- `packages/wire/docs/runtime/workers.md`
