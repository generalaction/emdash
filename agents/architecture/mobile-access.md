# Mobile Access

Mobile Access lets a phone connect directly to the running desktop app over a trusted private
LAN or user-managed VPN. There is no Emdash-hosted relay: the Electron main process remains
the authority for authentication, session state, task context, and all desktop operations.

## Ownership Boundaries

- `apps/emdash-mobile/` owns the responsive React client and browser-side API adapter.
- `apps/emdash-desktop/src/main/core/mobile-access/` owns the HTTP/WebSocket gateway,
  pairing, session cookies, static assets, and network validation.
- `apps/emdash-desktop/src/main/core/mobile-domain/` adapts the authenticated mobile API to
  desktop services and constructs safe task context.
- `packages/core/src/mobile-access/` owns the versioned, typed mobile contract.
- `packages/wire/src/api/transports/websocket.ts` owns the shared WebSocket transport.
- `apps/emdash-desktop/src/renderer/features/settings/components/MobileAccessSettingsPage.tsx`
  owns the desktop setup and pairing UI.

The gateway serves the mobile bundle and exposes pairing, session, logout, and authenticated
WebSocket endpoints. Do not expose desktop RPC wholesale or send raw filesystem roots to the
browser; add narrowly scoped operations to the shared contract and enforce authorization in
the desktop adapter.

## Security and Lifecycle

The gateway must bind only to an explicitly selected private interface, validate `Host` and
`Origin`, and keep authentication state in memory. The session cookie is `HttpOnly` and
`SameSite=Strict`. Pairing and active sessions intentionally reset whenever the desktop app
or Mobile Access server restarts.

Mobile Access v1 is plaintext HTTP. It is intended only for a trusted private LAN or a
user-managed private VPN such as Tailscale or WireGuard. Never add instructions that expose
or port-forward the gateway to the public internet without first adding an appropriate TLS
and authentication threat model.

A paired device is a fully trusted remote-control client: it can type into terminals, send agent
prompts, and approve agent actions, all of which can modify files, Git state, and other data
available to the desktop process. “Read-only” applies only to the dedicated file and diff API;
it is not a sandbox for terminals or agents.

The v1 client can work with existing projects and tasks, conversations, and terminals. Opening a
dormant task mounts its project and provisions its workspace through the normal desktop task
lifecycle. The client can start and rename sessions and inspect files and diffs through read-only
viewer endpoints. It does not provide a public relay, built-in TLS, desktop browser or cookie
streaming, or project or task creation.

## Development

See [`apps/emdash-mobile/README.md`](../../apps/emdash-mobile/README.md) for local development,
integrated gateway, build, and focused validation commands.
