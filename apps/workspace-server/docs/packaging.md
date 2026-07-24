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
3. Downloads the pinned ripgrep release for the target, verifies its repository-owned SHA-256,
   and copies `rg` plus its license files into the artifact.
4. Downloads the official Node version pinned by the repository's `.nvmrc`, verifies it against
   Node's published `SHASUMS256.txt`, and copies its `node` executable into the artifact.
5. Writes the launcher and manifest, then creates the archive under `dist-artifacts/`.
6. Writes a sibling `<archive>.sha256` file suitable for `sha256sum -c` verification.

Artifact URLs are immutable. Once an archive has been published for a workspace-server version,
that version must never be rebuilt with different contents. Any change that affects the packaged
artifact requires a version bump in `apps/workspace-server/package.json` before publication. The
desktop installer deliberately treats an existing `versions/<version>/` directory as final.

## Publish a Release

Workspace-server releases use the same Cloudflare R2 bucket and credentials as desktop releases.
All workspace-server objects live under the `workspace-server/` prefix:

```text
workspace-server/
  install.sh
  latest.txt
  <version>/
    emdash-workspace-server-<version>-linux-x64.tar.gz
    emdash-workspace-server-<version>-linux-x64.tar.gz.sha256
    emdash-workspace-server-<version>-linux-arm64.tar.gz
    emdash-workspace-server-<version>-linux-arm64.tar.gz.sha256
    emdash-workspace-server-<version>-darwin-arm64.tar.gz
    emdash-workspace-server-<version>-darwin-arm64.tar.gz.sha256
```

The release workflow builds and smoke-verifies all three targets, tests `install.sh` against a
local `file://` mirror of the assembled release, and publishes the versioned artifacts. Existing
versioned objects may only be skipped when their contents have the same SHA-256; the uploader
refuses to replace different contents. It uploads `latest.txt` last so an incomplete release is
never selected by a new installation.

To release:

1. Bump `version` in `apps/workspace-server/package.json`. Never reuse a published version.
2. Merge the change to `main`.
3. Dispatch `.github/workflows/release-workspace-server.yml` from GitHub Actions, or run:

```bash
gh workflow run release-workspace-server.yml --ref main
```

The workflow fails before building if the version's Linux x64 archive already exists at
`https://releases.emdash.sh/workspace-server/`. Pull requests and pushes to `main` that affect the
workspace server or its bundled workspace packages also run
`.github/workflows/workspace-server-package-check.yml`, which packages and verifies Linux x64.

Downloaded Node archives are cached under `~/.cache/emdash/workspace-server/`. Set
`EMDASH_WS_PACKAGE_CACHE_DIR` to use another cache directory.

## Artifact Layout

```text
emdash-workspace-server/
  bin/emdash-workspace-server
  bin/rg
  node
  dist/
    index.mjs
    <ten worker>.mjs
    <shared chunks>.mjs
  licenses/
    ripgrep/
      COPYING
      LICENSE-MIT
      UNLICENSE
  node_modules/
    <native packages and runtime dependencies>
  manifest.json
```

The POSIX shell launcher resolves the artifact relative to its own path, exports the packaged app
version as `EMDASH_WS_APP_VERSION`, selects the bundled `bin/rg` through
`EMDASH_WS_RIPGREP_PATH`, and executes `dist/index.mjs` with the bundled Node runtime. The archive
may therefore be extracted to any directory. Source development runs do not set the ripgrep
override and continue to resolve `rg` from `PATH`.

`manifest.json` records the package name and version, workspace-server protocol version, target OS
and architecture, and bundled Node and ripgrep versions.

## Linux Compatibility

Linux artifacts use the official glibc-linked Node.js distribution and native modules built on
Debian Bookworm. The bundled ripgrep executable uses its upstream static musl target, but the
complete workspace-server artifact is still intended for glibc-based Linux hosts. Alpine and other
musl-based systems are not supported; a separate musl build pipeline would be required for those
hosts.

See `docker-remote.md` for the bare SSH container used to exercise installation and socket
forwarding with these artifacts.
