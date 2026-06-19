# Contributing to Emdash

Thanks for your interest in contributing! We favor small, focused PRs and clear intent over big bangs. This guide explains how to get set up, the workflow we use, and a few project‑specific conventions.

## Quick Start

### Prerequisites

**All platforms**

- **Node.js 24.0.0+ (recommended: 24.14.0)** and **pnpm 10.28.0+**
- **Git**
- Optional (recommended for end‑to‑end testing):
  - GitHub CLI (`brew install gh` on macOS, `winget install GitHub.cli` on Windows; then `gh auth login`)
  - At least one supported coding agent CLI (see docs for list)

**macOS**

No extra setup needed. Use [nvm](https://github.com/nvm-sh/nvm) to manage Node versions:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 24.14.0
```

Or install via Homebrew: `brew install node@24 pnpm`

**Windows**

The app uses two native Node modules (`better-sqlite3` and `node-pty`) that must be compiled from source. You need a C++ build toolchain before running `pnpm install`.

1. **Install Visual Studio 2022 Build Tools** with the "Desktop development with C++" workload.
   The fastest way is via `winget`:
   ```powershell
   winget install Microsoft.VisualStudio.2022.BuildTools `
     --override "--add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --quiet"
   ```
   Alternatively, download the [VS Build Tools installer](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   and check "Desktop development with C++" during setup.

2. **Install Node.js 24.14.0** via [nvm-windows](https://github.com/coreybutler/nvm-windows) (recommended)
   or the [official installer](https://nodejs.org/):
   ```powershell
   # With nvm-windows:
   nvm install 24.14.0
   nvm use 24.14.0
   ```

3. **Install pnpm** (in an elevated PowerShell if needed):
   ```powershell
   npm install -g pnpm@10.28.2
   ```

4. Use **PowerShell** or **Git Bash** for all commands below — avoid `cmd.exe`.

> **Troubleshooting native builds on Windows:** If `pnpm install` fails with a node-gyp
> error, confirm that `node --version` shows 24.x and that `where msbuild` finds an
> MSBuild from the 2022 Build Tools. Run `npm config set msvs_version 2022` if node-gyp
> picks up an older toolchain.

### Setup

```bash
# Fork this repo, then clone your fork
git clone https://github.com/<you>/emdash.git
cd emdash

# Use the correct Node.js version (if using nvm / nvm-windows)
nvm use

# Install dependencies and run the dev server from the repo root
# This also compiles better-sqlite3 and node-pty for Electron automatically.
pnpm install
pnpm run dev

# Format, lint, type check, and test
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```

If you are already in `apps/emdash-desktop/`, `pnpm run d` is shorthand for installing
dependencies and starting the dev app.

> **Tip:** During development, the renderer hot‑reloads. Changes to the Electron main
> process (files in `apps/emdash-desktop/src/main`) require a restart of the dev app.

#### Skipping native rebuilds

Set these environment variables to skip compiling native modules (useful if you are only
working on the renderer or running in CI without a C++ toolchain):

```bash
EMDASH_DISABLE_PTY=1        # skip node-pty rebuild
EMDASH_DISABLE_NATIVE_DB=1  # skip better-sqlite3 rebuild
```

## Project Overview

The repo is a pnpm workspace monorepo; the Electron app lives in `apps/emdash-desktop/`. The root `package.json` provides aggregate scripts (`dev`, `build`, `test`, `lint`, `format`, `typecheck`); everything else runs from `apps/emdash-desktop/`.

- `apps/emdash-desktop/src/main/` – Electron main process, RPC controllers, services (Git, worktrees, PTY manager, DB, etc.)
- `apps/emdash-desktop/src/renderer/` – React UI (Vite), organized around `app/`, `features/`, and `lib/`
- Local database – SQLite file created under the OS userData folder (see "Local DB" below)
- Worktrees – Git worktrees are created outside your repo root in a sibling `worktrees/` folder
- Logs – Agent terminal output and app logs are written to the OS userData folder (not inside repos)

## Development Workflow

1. Create a feature branch

```
 git checkout -b feat/<short-slug>
```

2. Make changes and keep PRs small and focused

- Prefer a series of small PRs over one large one.
- Include UI screenshots/GIFs when modifying the interface.
- Update docs (README or inline help) when behavior changes.

3. Run checks locally

```
pnpm run format     # Format code with oxfmt (required)
pnpm run lint       # oxlint
pnpm run typecheck  # TypeScript type checking
pnpm run test       # Vitest test suite
```

There are no pre-commit hooks; run the full local gate above before opening or merging a PR. CI enforces `format:check`, `typecheck`, and `lint` when you open a PR.

4. Commit using Conventional Commits

- `feat:` – new user‑facing capability
- `fix:` – bug fix
- `chore:`, `refactor:`, `docs:`, `perf:`, `test:` etc.

Examples

```
fix(opencode): change initialPromptFlag from -p to --prompt for TUI

feat(docs): add changelog tab with GitHub releases integration
```

5. Open a Pull Request

- Describe the change, rationale, and testing steps.
- Link related Issues.
- Keep the PR title in Conventional Commit format if possible.

## Code Style and Patterns

TypeScript + oxlint + oxfmt

For full-project checks run:

- `pnpm run format` -- format all files with oxfmt
- `pnpm run lint` -- oxlint across all files
- `pnpm run typecheck` -- TypeScript type checking (whole project)
- `pnpm run test` -- run the test suite

Electron main (Node side)

- Prefer `execFile` over `exec` to avoid shell quoting issues.
- Never write logs into Git worktrees. All logs belong in the Electron `userData` folder.
- Be conservative with console logging; noisy logs reduce signal. Use clear prefixes.

Git and worktrees

- The app creates worktrees in a sibling `../worktrees/` folder.
- Do not delete worktree folders from Finder/Explorer; if you need cleanup, use:
  - `git worktree prune` (from the main repo)
  - or the in‑app workspace removal

Renderer (React)

- Feature UI lives under `apps/emdash-desktop/src/renderer/features/<feature>/`; shared primitives, hooks, and stores under `apps/emdash-desktop/src/renderer/lib/`.
- Agent CLIs are embedded via terminal emulation (xterm.js) - each agent runs in its own PTY.
- Use existing UI primitives and Tailwind utility classes for consistency.
- Aim for accessible elements (labels, `aria-*` where appropriate).

Local DB (SQLite)

- Development location (Electron `app.getPath('userData')`; dev builds use an `emdash-dev` folder):
  - macOS: `~/Library/Application Support/emdash-dev/emdash4.db`
  - Linux: `~/.config/emdash-dev/emdash4.db`
  - Windows: `%APPDATA%\emdash-dev\emdash4.db`
- Override the path with the `EMDASH_DB_FILE` environment variable for isolated/scratch databases.
- Reset: quit the app and run `pnpm --filter @emdash/emdash-desktop run db:reset` from the repo root, or delete the dev database file and relaunch (the schema is recreated).

## Issue Reports and Feature Requests

- Use GitHub Issues. Include:
  - OS, Node version
  - Steps to reproduce
  - Relevant logs (renderer console, terminal output)
  - Screenshots/GIFs for UI issues

## Release Process (maintainers)

Use pnpm's built-in versioning to ensure consistency. The app version lives in
`apps/emdash-desktop/package.json`, so run these from `apps/emdash-desktop/`:

```bash
# For bug fixes (0.2.9 → 0.2.10)
pnpm version patch

# For new features (0.2.9 → 0.3.0)
pnpm version minor

# For breaking changes (0.2.9 → 1.0.0)
pnpm version major
```

This automatically:

1. Updates `package.json` and `pnpm-lock.yaml`
2. Creates a git commit with the version number (e.g., `"0.2.10"`)
3. Creates a git tag (e.g., `v0.2.10`)

Then push the commit and tag. Production release builds are dispatched from GitHub Actions.

### What happens next

The release pipeline is split across these GitHub Actions workflows:

**Production Release** (`.github/workflows/release-prod.yml`):

1. Builds Linux, Windows, and macOS packages
2. Signs Windows builds when Azure Trusted Signing secrets are configured
3. Signs, verifies, notarizes, and staples macOS DMGs and ZIPs
4. Publishes artifacts to GitHub Releases (primary update feed) and Cloudflare R2 (fallback)

**Linux/Nix Build** (`.github/workflows/nix-build.yml`):

1. Computes the correct dependency hash from `pnpm-lock.yaml`
2. Builds the x86_64-linux package via Nix flake
3. Pushes build artifacts to Cachix and uploads the Nix artifact when available

**Canary Release** (`.github/workflows/release-canary.yml`):

1. Builds Linux, Windows, and macOS packages with the canary config
2. Publishes artifacts to the `v1-canary` R2 channel

