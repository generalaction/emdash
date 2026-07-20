# Workspace Server Packaging

The workspace server is distributed as a self-contained archive for each supported operating
system and architecture. A remote machine does not need Node.js, npm, pnpm, or the Emdash
monorepo installed.

## Supported Targets

- `linux-x64`
- `linux-arm64`
- `darwin-arm64`

Darwin artifacts must be built on a matching Darwin host. Linux artifacts are built with Docker
Buildx, so either Linux architecture can be produced from a supported Docker host.

## Build an Artifact

Run the packaging command from `apps/workspace-server/` and provide one or more targets:

```bash
pnpm run package --target darwin-arm64
pnpm run package --target linux-x64 --target linux-arm64
```

Add `--verify` to smoke-test each finished archive:

```bash
pnpm run package --target darwin-arm64 --verify
pnpm run package --target linux-x64 --verify
```

Darwin verification extracts the archive into a temporary directory and runs the daemon's
`start`, `status`, and `stop` commands with an isolated socket. Linux verification runs the same
sequence in `debian:bookworm-slim`, where no host Node.js installation is available.

The packaging process:

1. Bundles the server and its ten workers with all pure-JavaScript dependencies emitted into the
   entry files or shared chunks.
2. Installs only `node-pty`, `better-sqlite3`, `@parcel/watcher`, and their runtime dependencies for
   the target platform. Linux native modules are compiled in the Docker builder; Darwin modules
   are installed with the downloaded target Node.js runtime.
3. Downloads the official Node version pinned by the repository's `.nvmrc`, verifies it against
   Node's published `SHASUMS256.txt`, and copies its `node` executable into the artifact.
4. Writes the launcher and manifest, then creates the archive under `dist-artifacts/`.

Downloaded Node archives are cached under `~/.cache/emdash/workspace-server/`. Set
`EMDASH_WS_PACKAGE_CACHE_DIR` to use another cache directory.

## Artifact Layout

```text
emdash-workspace-server/
  bin/emdash-workspace-server
  node
  dist/
    index.mjs
    <ten worker>.mjs
    <shared chunks>.mjs
  node_modules/
    <native packages and runtime dependencies>
  manifest.json
```

The POSIX shell launcher resolves the artifact relative to its own path, exports the packaged app
version as `EMDASH_WS_APP_VERSION`, and executes `dist/index.mjs` with the bundled Node runtime.
The archive may therefore be extracted to any directory.

`manifest.json` records the package name and version, workspace-server protocol version, target OS
and architecture, and bundled Node version.

## Linux Compatibility

Linux artifacts use the official glibc-linked Node.js distribution and native modules built on
Debian Bookworm. They are intended for glibc-based Linux hosts. Alpine and other musl-based systems
are not supported; a separate musl build pipeline would be required for those hosts.

See `docker-remote.md` for the bare SSH container used to exercise installation and socket
forwarding with these artifacts.
