# Risky Area: Updater And Packaging

## Main Files

- `src/main/core/updates/update-service.ts`
- `src/main/core/updates/controller.ts`
- `build/`
- `package.json`
- `electron-builder.config.ts`
- `electron-builder.canary.config.ts`
- `scripts/release/build.ts`
- `scripts/release/notarize-mac.ts`
- `scripts/release/rebuild-native.ts`
- `scripts/release/upload-github-assets.ts`
- `scripts/release/finalize-release.ts`
- `.github/workflows/release-prod.yml`
- `.github/workflows/release-canary.yml`

## Rules

- avoid changing updater defaults casually
- treat signing, notarization, packaging targets, and native rebuild flow as release-critical
- keep build output directories and packaging config stable unless the task is explicitly about release behavior

## Update Feed / Publishing Strategy

The stable release pipeline publishes to **GitHub Releases** (primary feed) and **Cloudflare R2**
(legacy/migration feed). Both feeds are served from the same platform builds and are promoted by a
single finalizer only after the complete supported architecture set builds and verifies.

### Two feeds, one artifact set

electron-builder emits channel manifests named by the **first** publish provider's `channel`:

- Stable: `provider: github` has no explicit channel → defaults to `latest` → emits `latest*.yml`.
- Canary: `provider: github` sets `channel: 'canary'` → emits `canary*.yml`.

The R2 feed uses different channel names (`v1-stable`, `v1-canary`) that pre-date the GitHub
migration. Rather than running a second packaging pass, `scripts/release/build.ts` calls
`duplicateChannelManifests()` after the electron-builder step to copy
`latest*.yml → v1-stable*.yml` (or `canary*.yml → v1-canary*.yml`). The duplicated manifests are
kept local until platform verification finishes. `upload-github-assets.ts` then hashes the final
files, refreshes manifest checksums and sizes, and uploads the artifacts and both manifest variants
to the exact owned GitHub draft. On macOS this happens only after notarization and stapling.

### Rollback-safe R2 promotion

Platform jobs never write the live R2 channel. `scripts/release/finalize-release.ts` first validates
the exact owned GitHub release, the complete architecture inventory, and every update manifest entry.
It downloads every referenced GitHub asset, verifies its SHA-512 against the manifest, uploads
installer assets under an immutable `releases/<tag>/<run>-<attempt>/` prefix, and rewrites the R2
manifests to those keys. Before replacing any root `v1-stable*.yml` or `v1-canary*.yml` object, it
snapshots the complete previous manifest set. Promotion or a confirmed GitHub publication failure
restores that set. The original snapshot is journaled in R2 by tag, run, and commit before any root
changes, so it survives retries and runner termination. If GitHub's response is ambiguous, the
complete new R2 set is retained; a retry restores the journaled public roots when the release is
still a draft or reconciles every root when publication actually succeeded.

### Update channels on GitHub

The app does **not** override `autoUpdater.channel`; the GitHub provider resolves the channel naturally:

- **Stable** (`allowPrerelease=false`): resolves to `latest`, fetches `latest*.yml` from the newest non-prerelease GitHub release.
- **Canary** (`allowPrerelease=true`): resolves the target release tag from the Atom feed by matching the semver prerelease identifier of the installed version (`canary`) against each entry. Once a `-canary.N` tag is found it fetches `canary*.yml` from that release, as defined by `channel: 'canary'` in `electron-builder.canary.config.ts`.

The `UPDATE_CHANNEL` / `v1-stable` / `v1-canary` naming applies **only** to the flat R2 bucket (via the `generic` publish block's `channel`). It is kept as a log label in `update-service.ts` for diagnostics but is not passed to `autoUpdater.channel`.

### R2 decommission path

R2 uploads continue until telemetry confirms all clients have migrated to the GitHub-backed feed. At that point:

1. Remove the `provider: generic` block from `electron-builder.config.ts` and `electron-builder.canary.config.ts`.
2. Remove R2 staging/promotion from `finalize-release.ts` and `duplicateChannelManifests` from
   `build.ts`.
3. Decommission the R2 bucket.

- Canary publishes to GitHub as prereleases. `ALLOW_PRERELEASE` in `update-service.ts` is driven by `IS_CANARY` so canary clients accept prerelease versions automatically.
- The `finalize-release.ts` script runs after all three platform builds complete, validates the
  exact release and manifest contents, promotes R2, and flips the GitHub draft to published. Until
  that job finishes the release remains invisible to GitHub-backed electron-updater clients.

## Release Scripts Library Usage

- `scripts/release/build.ts` — uses `electron-builder`'s programmatic `build()` API (no CLI spawn)
- `scripts/release/upload-github-assets.ts` — uploads only final, platform-scoped artifacts after
  verification and regenerates updater metadata from their bytes
- `scripts/release/rebuild-native.ts` — uses `@electron/rebuild`'s `rebuild()` API (no CLI spawn)
- `scripts/release/notarize-mac.ts` — uses `@electron/notarize`'s `notarize()` API for DMG submission + auto-staple; system spawns are kept only for `.app` bundle stapling and Gatekeeper verification

## Release Manifest Parser Dependency

Release scripts declare `yaml` 2.9 as a direct development dependency because electron-builder
emits YAML updater manifests that must be parsed, structurally validated, merged, and serialized.
Node.js does not provide a YAML parser. A handwritten parser would be unsafe, while importing the
copy used transitively by Vite or electron-builder would create an undeclared and unstable
dependency on their internal dependency graphs.

Dependency assessment recorded on 2026-09-01:

- `yaml` 2.9.0 was already resolved in `pnpm-lock.yaml`, so declaring it directly adds no package
  resolution or transitive dependency
- the package uses the permissive ISC license, has no runtime dependencies or native components,
  and defines no install or postinstall lifecycle hook
- a targeted `pnpm audit` check reports no advisory for `yaml`; the workspace-wide audit still
  reports unrelated existing dependency findings and is not considered clean
- it remains a development dependency because only repository release tooling imports it; it is not
  shipped as an application runtime dependency

## Current Notes

- macOS and Linux release jobs rebuild native modules for the target Electron version
- Linux releases use `.github/workflows/release-linux.yml` to build x64 and arm64 in a
  native-runner matrix inside the same Ubuntu 22.04 userspace baseline. Both architectures emit
  AppImage, DEB, and RPM artifacts. Verification extracts every package payload and checks the main
  executable, required native modules, binary architecture, package metadata, and GLIBC ceiling.
- Production and canary workflows have separate non-canceling concurrency groups. Every build and
  the finalizer receives the exact draft id; a run/commit marker prevents a different dispatch from
  adopting a stale draft.
- Production and canary remain separate release entry points because they select different product
  identities, versions, and publication semantics. Both call the same reusable Linux architecture
  matrix; there are not separate stable and canary Linux implementations.
- A public desktop release always includes x64 and arm64. Failed architecture jobs are retried at
  the GitHub Actions job level rather than publishing a partial updater release.
- changelog and auto-update behavior are separate but related surfaces in the app
- the `finalize-release` CI job requires `contents: write` permission and the default `GITHUB_TOKEN`
