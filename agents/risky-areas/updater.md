# Risky Area: Updater And Packaging

## Main Files

- `src/main/core/updates/AutoUpdateService.ts`
- `src/main/core/updates/controller.ts`
- `build/`
- `package.json`
- `.github/workflows/release.yml`
- `.github/workflows/windows-beta-build.yml`
- `.github/workflows/nix-build.yml`

## Rules

- avoid changing updater defaults casually
- treat signing, notarization, packaging targets, and native rebuild flow as release-critical
- keep build output directories and packaging config stable unless the task is explicitly about release behavior

## Current Notes

- macOS and Linux release jobs rebuild native modules for the target Electron version
- Windows beta builds intentionally use Node 20 in CI for native module stability
- changelog and auto-update behavior are separate but related surfaces in the app
