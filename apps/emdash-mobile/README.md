# Emdash Mobile

This package is the phone-sized web client for Mobile Access. The desktop app builds and
serves it from the local Mobile Access gateway; it is not a separately hosted cloud service.

## Use Mobile Access

With Emdash running on the desktop:

1. Open **Settings > Mobile Access**.
2. Select a private LAN or user-managed VPN address and a port, then enable access.
3. Open the displayed URL on the phone.
4. Generate a one-time pairing code on the desktop and enter it on the phone.

Keep the desktop running and awake while using the mobile client. Pairing codes and sessions
are held in memory and are cleared whenever the desktop app or Mobile Access server restarts.

> [!WARNING]
> The v1 gateway uses plaintext HTTP. Only use it on a trusted private LAN or a private VPN
> such as Tailscale or WireGuard. Do not expose or port-forward it to the public internet.
> Pairing grants remote terminal and agent control, including the ability to run commands that
> modify files, Git state, and other data available to Emdash.

The mobile client can navigate existing projects and tasks, interact with conversations and
terminals, start and rename sessions, inspect files and diffs, and open browser URLs. The
dedicated file and diff viewers are read-only; terminal commands and approved agent actions are
not. v1 has no public relay, built-in TLS, desktop browser or cookie streaming, or project or
task creation.

## Development

Install workspace dependencies from the repository root:

```bash
pnpm install
```

For visual development with fixture data, run the Vite app and append `?demo=1` to the URL
shown in the terminal:

```bash
pnpm --filter @emdash/emdash-mobile run dev
```

For an end-to-end gateway session, run the desktop development target. It also starts the
mobile build watcher, and the desktop gateway serves the generated assets after Mobile
Access is enabled in Settings:

```bash
pnpm --filter @emdash/emdash-desktop run dev
```

Build only the mobile bundle, or build the desktop app and copy the mobile bundle into its
output:

```bash
pnpm --filter @emdash/emdash-mobile run build
pnpm --filter @emdash/emdash-desktop run build
```

Run focused checks with:

```bash
pnpm --filter @emdash/emdash-mobile run format:check
pnpm --filter @emdash/emdash-mobile run lint
pnpm --filter @emdash/emdash-mobile run typecheck
pnpm --filter @emdash/emdash-mobile run test
```

See [`agents/architecture/mobile-access.md`](../../agents/architecture/mobile-access.md)
for ownership boundaries and security invariants.
