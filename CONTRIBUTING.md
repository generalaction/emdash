# Contributing to Scrawl

Thanks for your interest in contributing. Scrawl is a fork of [Emdash](https://github.com/generalaction/emdash), an Agentic Development Environment built by the team at [generalaction](https://github.com/generalaction). We're deeply grateful for their creativity and open source work — Scrawl would not exist without it.

Scrawl repositions that foundation as an **Agentic Writer Environment (AWE)**: the same parallel, isolated, worktree-based workflow applied to written content creation, built for copywriters, content writers, proposal writers, and technical writers.

We favor small, focused PRs and clear intent. This guide covers setup, workflow, and project conventions.

---

## Why Scrawl Exists

Agentic workflows have transformed software development. The same underlying mechanics — parallel agents, isolated workspaces, human-reviewed diffs — are equally valuable for writers. Scrawl exists to bring that workflow to anyone producing written content with LLMs.

We are aware of the risks: agentic writing can produce generic, homogenized output. Our stance is to mitigate this through good tooling and process — structured review, style enforcement via skills, Best-of-N comparison, and source attribution in RAG workflows — not to avoid AI-assisted writing altogether. Contributions that improve the human-in-the-loop experience are especially welcome.

---

## Quick Start

**Prerequisites**

- **Node.js 20.0.0+ (recommended: 22.20.0)** and Git
- Optional but recommended for end-to-end testing:
  - GitHub CLI (`brew install gh`; then `gh auth login`)
  - At least one supported CLI agent (see [Supported Agents](README.md#agents))

**Setup**

```bash
# Fork this repo, then clone your fork
git clone https://github.com/gidea/scrawl
cd scrawl

# Use the correct Node.js version (if using nvm)
nvm use

# Quick start: install dependencies and run dev server
pnpm run d

# Or run separately:
pnpm install
pnpm run dev

# Type checking, lint, build
pnpm run type-check
pnpm run lint
pnpm run build
```

During development, the renderer hot-reloads. Changes to the Electron main process (`src/main/`) require a restart of the dev app.

---

## Project Overview

- `src/main/` — Electron main process, IPC handlers, services (Git, worktrees, PTY manager, DB, etc.)
- `src/renderer/` — React UI (Vite), hooks, components
- `src/shared/` — Provider registry, shared utilities
- Local database — SQLite file in the OS userData folder (see Local DB below)
- Worktrees — Git worktrees are created in a sibling `../worktrees/` folder
- Logs — Agent terminal output and app logs go to the OS userData folder, not inside repos

---

## Development Workflow

**1. Create a feature branch**

```bash
git checkout -b feat/<short-slug>
```

**2. Make changes — keep PRs small and focused**

- Prefer a series of small PRs over one large one.
- Include UI screenshots or GIFs when modifying the interface.
- Update docs (README or inline help) when behavior changes.

**3. Run checks locally**

```bash
pnpm run format      # Format code with Prettier (required)
pnpm run type-check  # TypeScript type checking
pnpm run lint        # ESLint
pnpm run build       # Build both main and renderer
pnpm exec vitest run # Run tests
```

Pre-commit hooks run automatically via Husky + lint-staged. Staged files are auto-formatted and linted on each commit. Type checking and tests run in CI only.

If you need to skip the hook for a work-in-progress commit, use `git commit --no-verify`. Checks will still run in CI when you open a PR.

**4. Commit using Conventional Commits**

- `feat:` — new user-facing capability
- `fix:` — bug fix
- `chore:`, `refactor:`, `docs:`, `perf:`, `test:`

Examples:

```
fix(opencode): change initialPromptFlag from -p to --prompt for TUI

feat(skills): add style-guide skill template for writers
```

**5. Open a Pull Request**

- Describe the change, rationale, and testing steps.
- Link related issues.
- Keep the PR title in Conventional Commit format if possible.

---

## Contribution Areas

**Writer-focused features (especially welcome):**
- Writer-specific skills (style guide enforcement, tone profiles, audience personas, format templates)
- Cloud vector database integrations via MCP (for RAG-backed writing workflows)
- Content project templates for common writing workflows
- UI improvements that reduce friction for non-developer users
- Anything that makes human review of agent output easier or more structured

**Inherited infrastructure (also needed):**
- New CLI agent integrations (see `src/shared/providers/registry.ts`)
- Bug fixes across the existing feature set
- Test coverage improvements
- Documentation improvements

---

## Code Style and Patterns

**TypeScript + ESLint + Prettier**

- `pnpm run format` — format all files
- `pnpm run type-check` — TypeScript type checking
- `pnpm run lint` — ESLint
- `pnpm exec vitest run` — run the test suite

**Electron main (Node side)**

- Prefer `execFile` over `exec` to avoid shell quoting issues.
- Never write logs into Git worktrees. All logs belong in the Electron `userData` folder.
- Be conservative with console logging; use clear prefixes.

**Git and worktrees**

- The app creates worktrees in a sibling `../worktrees/` folder.
- Do not delete worktree folders from Finder/Explorer; use `git worktree prune` from the main repo or the in-app workspace removal.

**Renderer (React)**

- Components live under `src/renderer/components`; hooks under `src/renderer/hooks`.
- Agents run in PTYs via xterm.js — each agent gets its own terminal session.
- Use existing UI primitives and Tailwind utility classes for consistency.
- Aim for accessible elements (labels, `aria-*` where appropriate).

**Local DB (SQLite)**

- macOS: `~/Library/Application Support/emdash/emdash.db`
- Linux: `~/.config/emdash/emdash.db`
- Windows: `%APPDATA%\emdash\emdash.db`
- Reset: quit the app, delete the file, relaunch (schema recreates automatically).

---

## Issue Reports and Feature Requests

Use GitHub Issues. Include:
- OS and Node version
- Steps to reproduce
- Relevant logs (renderer console, terminal output)
- Screenshots or GIFs for UI issues

---

## Release Process (maintainers)

```bash
# Bug fix (0.2.9 → 0.2.10)
pnpm version patch

# New feature (0.2.9 → 0.3.0)
pnpm version minor

# Breaking change (0.2.9 → 1.0.0)
pnpm version major
```

This automatically updates `package.json`, creates a git commit, and creates a version tag. Push to trigger the CI/CD pipeline.

### What happens next

**macOS Release** (`.github/workflows/release.yml`):
1. Builds TypeScript and Vite bundles
2. Signs with Apple Developer ID
3. Notarizes via Apple's notary service
4. Creates a GitHub Release with DMG artifacts for arm64 and x64

**Linux/Nix Build** (`.github/workflows/nix-build.yml`):
1. Computes dependency hash from `pnpm-lock.yaml`
2. Builds x86_64-linux package via Nix flake
3. Pushes build artifacts to Cachix
