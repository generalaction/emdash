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
- `scripts/release/finalize-release.ts`
- `.github/workflows/release-prod.yml`
- `.github/workflows/release-canary.yml`
- `.github/workflows/windows-beta-build.yml`
- `.github/workflows/nix-build.yml`

## Rules

- avoid changing updater defaults casually
- treat signing, notarization, packaging targets, and native rebuild flow as release-critical
- keep build output directories and packaging config stable unless the task is explicitly about release behavior

## Update Feed / Publishing Strategy

The stable release pipeline publishes to **GitHub Releases** (primary feed) and **Cloudflare R2** (fallback during migration) in parallel:

- `electron-builder.config.ts` lists `provider: github` first, then `provider: generic` (R2). The first provider determines the runtime feed embedded in `app-update.yml`.
- R2 uploads via `scripts/release/upload-r2.ts` continue until telemetry confirms all clients have migrated to the GitHub-backed feed, at which point R2 can be decommissioned (Phase 3 of the migration plan).
- Canary currently uses R2 only. When canary moves to GitHub, use `releaseType: 'prerelease'` in its electron-builder config. `ALLOW_PRERELEASE` in `update-service.ts` is already driven by `IS_CANARY` so it will activate automatically.
- The `finalize-release.ts` script runs after all three platform builds complete to flip the draft GitHub release to published. Until that job finishes the release remains a draft and is invisible to electron-updater clients.

## Release Scripts Library Usage

- `scripts/release/build.ts` — uses `electron-builder`'s programmatic `build()` API (no CLI spawn)
- `scripts/release/rebuild-native.ts` — uses `@electron/rebuild`'s `rebuild()` API (no CLI spawn)
- `scripts/release/notarize-mac.ts` — uses `@electron/notarize`'s `notarize()` API for DMG submission + auto-staple; system spawns are kept only for `.app` bundle stapling and Gatekeeper verification

## Current Notes

- macOS and Linux release jobs rebuild native modules for the target Electron version
- Windows beta builds intentionally use Node 20 in CI for native module stability
- changelog and auto-update behavior are separate but related surfaces in the app
- the `finalize-release` CI job requires `contents: write` permission and the default `GITHUB_TOKEN`
