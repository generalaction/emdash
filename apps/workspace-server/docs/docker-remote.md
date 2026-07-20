# Docker Remote Machine

The package-owned `workspace-remote` Compose service is a deliberately bare SSH host for exercising
the complete desktop-to-workspace-server connection path. It includes SSH, Git, tmux, and basic
process tools, but no Node.js, npm, build toolchain, or coding-agent CLI.

The daemon exposes no TCP port. Clients reach its Unix socket through SSH streamlocal forwarding,
matching the production topology.

## Connection

Start the container from `apps/workspace-server/`:

```bash
pnpm run run:docker-remote
```

Use these SSH connection settings in Emdash:

- Host: `localhost`
- Port: `2223`
- User: `devuser`
- Password: `devpass`

For a command-line session:

```bash
ssh -p 2223 devuser@localhost
```

The default mode is intentionally empty. Confirm that it has no host Node.js installation:

```bash
ssh -p 2223 devuser@localhost 'node --version'
# bash: node: command not found
```

This is the mode for testing OS and architecture detection, artifact upload and installation,
daemon startup, reconnects, and desktop-managed streamlocal forwarding.

## Preinstall And Autostart Modes

First build an artifact matching the container architecture. Apple Silicon uses `linux-arm64`
natively:

```bash
pnpm run package --target linux-arm64
```

Set `WORKSPACE_SERVER_PREINSTALL=1` to install the newest matching artifact mounted from
`dist-artifacts/`:

```bash
WORKSPACE_SERVER_PREINSTALL=1 pnpm run run:docker-remote
```

The entrypoint extracts it under
`/home/devuser/.local/share/emdash/workspace-server/<version>/` and updates the `current` symlink.
The named home volume preserves this installation and daemon state across container recreation.

Set both toggles to start the installed daemon during container startup:

```bash
WORKSPACE_SERVER_PREINSTALL=1 WORKSPACE_SERVER_AUTOSTART=1 pnpm run run:docker-remote
```

Check its health from the host:

```bash
ssh -p 2223 devuser@localhost \
  '~/.local/share/emdash/workspace-server/current/bin/emdash-workspace-server status'
```

`WORKSPACE_SERVER_AUTOSTART=1` can be used without preinstall after an installation already exists
in the persistent home volume.

Run the desktop connection smoke test against the installed daemon:

```bash
pnpm --dir ../emdash-desktop run test:workspace-server-remote
```

The test uses the Compose service's fixed `localhost:2223` and `devuser`/`devpass` credentials. It
starts an isolated daemon socket under `/home/devuser/.emdash-workspace-server-test`, exercises SSH
reconnection and daemon restart, then stops the daemon and removes its temporary workspace.

## Logs And Socket Forwarding

The daemon log is stored beside its socket. Follow it without opening an SSH session:

```bash
docker exec --user devuser emdash-workspace-remote \
  tail -f /home/devuser/.emdash/workspace-server/run/workspace.sock.log
```

To inspect streamlocal forwarding manually, first start the daemon, then run:

```bash
rm -f /tmp/emdash-workspace-server.sock
ssh -p 2223 -N \
  -L /tmp/emdash-workspace-server.sock:/home/devuser/.emdash/workspace-server/run/workspace.sock \
  devuser@localhost
```

While that SSH process is running, `/tmp/emdash-workspace-server.sock` is the local endpoint. The
desktop transport performs the same forwarding in-process and calls Wire `initialize` before using
runtime services.

## Reset To A Bare Machine

Stop the Compose project and delete its named volumes:

```bash
docker compose down -v
```

This removes only the workspace remote container, network, and its `emdash-workspace-remote-home`
volume. The legacy desktop `ssh-dev` Compose project and its `projects` volume are separate.

## Testing Another Architecture

The service uses the host's native Linux architecture by default. On Apple Silicon, set the
optional Compose platform to exercise the `linux-x64` artifact and architecture-detection branch
under emulation:

```bash
pnpm run package --target linux-x64
WORKSPACE_REMOTE_PLATFORM=linux/amd64 \
  WORKSPACE_SERVER_PREINSTALL=1 \
  WORKSPACE_SERVER_AUTOSTART=1 \
  pnpm run run:docker-remote
```

Docker runs the amd64 image with its equivalent of `--platform linux/amd64`; startup is slower
than the native arm64 container.
