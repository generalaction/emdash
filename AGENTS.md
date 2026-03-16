---
default_branch: main
package_manager: pnpm
node_version: "22.20.0"
start_command: "pnpm run d"
dev_command: "pnpm run dev"
build_command: "pnpm run build"
test_commands:
  - "pnpm run format"
  - "pnpm run lint"
  - "pnpm run type-check"
  - "pnpm exec vitest run"
ports:
  dev: 3000
required_env: []
optional_env:
  - TELEMETRY_ENABLED
  - EMDASH_DB_FILE
  - EMDASH_DISABLE_NATIVE_DB
  - EMDASH_DISABLE_CLONE_CACHE
  - EMDASH_DISABLE_PTY
  - CODEX_SANDBOX_MODE
  - CODEX_APPROVAL_POLICY
---

# Emdash

Cross-platform Electron app for running multiple CLI coding agents in parallel, each isolated in its own Git worktree. Emdash also supports remote development over SSH, issue-driven task creation, MCP server management, diff review, PR workflows, and an embedded docs site.

## Dev Environment Tips

- Use Node `22.20.0` from `.nvmrc`. The repo expects `pnpm@10.28.2`.
- `pnpm run d` installs dependencies and starts Electron main plus the Vite renderer.
- `pnpm run dev` starts the app without reinstalling dependencies.
- `pnpm test` is a shortcut for `vitest run`.
- `pnpm run docs` starts the docs app in `docs/` using Next.js.
- `pnpm --dir docs run types:check` runs the docs app type check.
- The docs app and the Electron renderer both default to port `3000`; do not run them on the same port at the same time without changing one side.
- After updating native dependencies (`sqlite3`, `node-pty`, `keytar`), run `pnpm run rebuild`.
- If native modules or lockfile state get wedged, use `pnpm run reset`.

## Tech Stack

- Runtime: Electron `30.5.1`, Node.js `>=20 <23`
- App frontend: React 18, TypeScript 5, Vite 5, Tailwind CSS 3, Radix UI, Framer Motion
- App data/state: SQLite, Drizzle ORM, TanStack Query
- Terminal/editor: `@xterm/xterm`, `node-pty`, Monaco Editor
- Integrations: GitHub CLI, Linear, Jira, GitLab, Forgejo, SSH, MCP
- Docs site: Next 16, React 19, Fumadocs, Tailwind CSS 4 in `docs/`

## Development Commands

```bash
# Install deps and launch Electron + Vite
pnpm run d

# Development
pnpm run dev
pnpm run dev:main
pnpm run dev:renderer

# Quality
pnpm run format
pnpm run format:check
pnpm run lint
pnpm run type-check
pnpm test
pnpm exec vitest run

# Targeted tests
pnpm exec vitest run src/test/main/WorktreeService.test.ts

# Native modules / cleanup
pnpm run rebuild
pnpm run clean
pnpm run reset

# Build / package
pnpm run build
pnpm run package
pnpm run package:mac
pnpm run package:linux
pnpm run package:win

# Docs
pnpm run docs
pnpm run docs:build
pnpm --dir docs run types:check
```

## Testing Instructions

- Read the current CI plan in `.github/workflows/`.
- Vitest is configured in `vite.config.ts` with `environment: 'node'` and `include: ['src/**/*.test.ts']`.
- App tests live under `src/test/main/`, `src/test/renderer/`, and `src/main/utils/__tests__/`.
- Tests rely on per-file `vi.mock()` setup; there is no shared global test bootstrap.
- Integration-style tests create temporary Git repos and worktrees in `os.tmpdir()`.
- Run the full local gate before merging:
  - `pnpm run format`
  - `pnpm run lint`
  - `pnpm run type-check`
  - `pnpm exec vitest run`
- Husky + lint-staged also run formatting and linting on staged files during commit.
- CI currently enforces `format:check`, `type-check`, and Vitest. Lint is still expected locally even though it is not enabled in `code-consistency-check.yml` yet.
- When changing behavior, add or update tests in the closest existing test area.
- After changing path resolution, imports, PTY behavior, or IPC contracts, rerun the relevant focused Vitest file before the full suite.

## Guardrails

- Always use feature branches or worktrees. Never commit directly to `main`.
- Never modify `drizzle/meta/` or numbered SQL migration files by hand. Use `pnpm exec drizzle-kit generate`.
- Avoid edits in `dist/`, `release/`, and `build/` unless the task is explicitly about packaging or updater/signing behavior.
- Treat `src/main/db/**`, `src/main/services/ptyManager.ts`, `src/main/services/ssh/**`, and updater code as high-risk areas.
- Do not change telemetry defaults, updater defaults, or signing configuration casually.
- Do not run global package installs, `git push`, or other machine-wide mutations from repo automation.
- Put scratch notes in `.notes/` if you need temporary working files.

## Architecture

### Process Model

- `src/main/`: Electron main process, IPC registration, services, database, PTY orchestration, updater, SSH, integrations
- `src/renderer/`: React renderer, task UI, terminal panes, diff review, settings, MCP, kanban, integrations
- `src/shared/`: provider registry, IPC helpers, shared MCP types, SSH/task/diff utilities, changelog helpers
- `docs/`: separate Next/Fumadocs documentation app

### Boot Sequence

`src/main/entry.ts` -> `src/main/main.ts` -> app lifecycle/window setup -> IPC registration -> renderer

- `entry.ts` sets the app name early and installs runtime path alias resolution for compiled CommonJS output.
- `main.ts` loads `.env`, normalizes PATH across macOS/Linux/Windows, initializes shell-derived env like `SSH_AUTH_SOCK`, sets single-instance behavior in production, initializes the database, updater, SSH, worktree pool, and IPC.
- `preload.ts` exposes `window.electronAPI` through `contextBridge`.

### Main Process

Important service areas:

- Worktrees and lifecycle:
  - `WorktreeService.ts`
  - `WorktreePoolService.ts`
  - `TaskLifecycleService.ts`
  - `LifecycleScriptsService.ts`
  - `ProjectPrep.ts`
- PTY and provider runtime:
  - `ptyManager.ts`
  - `ptyIpc.ts`
  - `providerStatusCache.ts`
  - `ConnectionsService.ts`
  - `AgentEventService.ts`
  - `ClaudeHookService.ts`
  - `OpenCodeHookService.ts`
  - `CodexSessionService.ts`
  - `PlainService.ts`
- Git and issue/PR integrations:
  - `GitService.ts`
  - `GitHubService.ts`
  - `GitLabService.ts`
  - `ForgejoService.ts`
  - `LinearService.ts`
  - `JiraService.ts`
  - `PrGenerationService.ts`
- App/platform services:
  - `DatabaseService.ts`
  - `RepositoryManager.ts`
  - `ProjectSettingsService.ts`
  - `AutoUpdateService.ts`
  - `ChangelogService.ts`
  - `browserViewService.ts`
  - `hostPreviewService.ts`
- Remote development:
  - `RemotePtyService.ts`
  - `RemoteGitService.ts`
  - `src/main/services/ssh/`
- Skills and MCP:
  - `SkillsService.ts`
  - `McpService.ts`

IPC is split between `src/main/ipc/` and a few colocated handler files in `src/main/services/` such as `worktreeIpc.ts`, `ptyIpc.ts`, `updateIpc.ts`, `lifecycleIpc.ts`, `planLockIpc.ts`, and `fsIpc.ts`.

Current IPC coverage includes app, db, debug, browser, host preview, GitHub, GitLab, Forgejo, Linear, Jira, skills, MCP, SSH, telemetry, project settings, network helpers, and plain terminal support.

There is also a small RPC router in `src/shared/ipc/rpc` currently used for `db`, `appSettings`, and `changelog`.

### Renderer Process

High-value renderer entry points:

- `src/renderer/App.tsx`: wraps the app in Query, modal, app, GitHub, project, task, settings, and theme providers
- `src/renderer/views/Workspace.tsx`: main app shell after first launch
- `src/renderer/components/MainContentArea.tsx`: routes between chat, multi-agent, project, settings, skills, MCP, kanban, and home views
- `src/renderer/components/ChatInterface.tsx`: single-task chat and terminal workflow
- `src/renderer/components/MultiAgentTask.tsx`: best-of-n / multi-agent task experience
- `src/renderer/components/ProjectMainView.tsx`: project dashboard without an active task
- `src/renderer/components/TaskModal.tsx` and `TaskAdvancedSettings.tsx`: task creation, provider selection, issue linking, advanced options
- `src/renderer/components/diff*` and `FileChangesPanel.tsx`: diff review, comments, and change inspection
- `src/renderer/components/skills/`: skills catalog and management
- `src/renderer/components/mcp/`: MCP management UI
- `src/renderer/components/kanban/`: task kanban board
- `src/renderer/components/integrations/`: GitLab and Forgejo setup flows
- `src/renderer/components/ssh/`: SSH connection UI

Notable hooks include task management, project management, provider detection, keyboard shortcuts, file changes, PR status, changelog/update notifications, comment injection, terminal search/selection, telemetry consent, and remote project handling.

### Path Aliases

`@/*` means different things in renderer vs main:

| Alias | Renderer (`tsconfig.json`) | Main (`tsconfig.main.json`) |
| --- | --- | --- |
| `@/*` | `src/renderer/*` | `src/*` |
| `@shared/*` | `src/shared/*` | `src/shared/*` |
| `#types/*` | `src/types/*` | unavailable |
| `#types` | `src/types/index.ts` | unavailable |

At runtime in compiled main output, `entry.ts` remaps:

- `@shared/*` -> `dist/main/shared/*`
- `@/*` -> `dist/main/main/*`

Main builds with CommonJS. Renderer builds with ESNext through Vite.

### IPC Contract Pattern

All new renderer-facing IPC methods must be declared in `src/renderer/types/electron-api.d.ts`.

Use the standard success envelope:

```ts
ipcMain.handle('example:action', async (_event, args) => {
  try {
    return { success: true, data: await service.doSomething(args) };
  } catch (error) {
    return { success: false, error: (error as Error).message };
  }
});
```

### Provider Registry

`src/shared/providers/registry.ts` is the source of truth for supported CLI agents.

Provider definitions capture:

- CLI name and detection commands
- version/detection args
- install command and docs URL
- auto-approve flags
- initial prompt behavior
- keystroke injection behavior for TUIs without prompt flags
- resume/session flags
- plan activation or auto-start commands
- icon metadata

When adding a provider:

1. Add it to `src/shared/providers/registry.ts`.
2. Add any required auth env passthrough to `AGENT_ENV_VARS` in `src/main/services/ptyManager.ts`.
3. Update any renderer UI that depends on provider metadata.
4. Add tests for detection/spawn logic if behavior is non-standard.

### PTY Management

`src/main/services/ptyManager.ts` is one of the most sensitive files in the repo.

Key behavior:

1. `startPty()` wraps a CLI in a shell and leaves the user with an interactive shell after exit.
2. `startDirectPty()` skips the shell wrapper and uses the cached CLI path when possible.
3. `startSshPty()` runs agent sessions on remote machines.
4. Optional tmux wrapping is controlled by `.emdash.json`.

Important implementation details:

- PTY IDs come from `src/shared/ptyId.ts`.
- Agent auth env passthrough is intentionally allowlisted in `AGENT_ENV_VARS`.
- GUI/display-related env vars are selectively forwarded for browser and desktop operations.
- Claude sessions use deterministic `--session-id` values for per-conversation isolation.
- Codex session support reads Codex's local SQLite state via `CodexSessionService` to reconnect to recent threads for the same cwd.
- Claude and OpenCode use hook/config helpers to emit structured events back into Emdash.
- `AgentEventService` receives hook callbacks, forwards normalized events to renderer windows, and can show OS notifications when the app is unfocused.

Be careful with PTY cleanup, resize handling, shell quoting, Windows command wrapping, and tmux session teardown.

### Worktrees And Project Config

`WorktreeService.ts` creates task worktrees under `../worktrees/` and preserves selected gitignored files from the main repo. `WorktreePoolService.ts` keeps reserve worktrees ready to reduce task startup latency.

`.emdash.json` currently supports:

- `preservePatterns`
- `scripts.setup`
- `scripts.run`
- `scripts.teardown`
- `shellSetup`
- `tmux`

`LifecycleScriptsService.ts` reads this config. `shellSetup` runs inside every PTY before the interactive shell starts. Lifecycle scripts are the right place for repo-specific bootstrap/teardown behavior.

### Skills And MCP

Skills:

- Shared skill logic lives in `src/shared/skills/`
- Main-process orchestration is in `src/main/services/SkillsService.ts`
- Renderer UI is in `src/renderer/components/skills/`
- Offline catalog fallback is in `src/main/services/skills/bundled-catalog.json`

MCP:

- `src/main/services/McpService.ts` reads, merges, adapts, and writes MCP server configs across agent ecosystems
- `src/main/services/mcp/` contains adapter and config-path logic
- `src/renderer/components/mcp/` is the management UI
- `src/shared/mcp/` contains shared MCP types

Codex currently only supports stdio MCP servers. The MCP UI handles provider compatibility constraints.

### Integrations And Remote Development

Issue and repo integrations currently span:

- GitHub
- GitLab
- Forgejo
- Linear
- Jira

Renderer setup flows and selectors live under `src/renderer/components/` and `src/renderer/components/integrations/`. Main-process service code lives in `src/main/services/`.

Remote development is implemented through:

- `src/main/services/ssh/`
- `RemotePtyService.ts`
- `RemoteGitService.ts`
- shared SSH/path validation helpers

Remote worktrees live under `<project>/.emdash/worktrees/<task-slug>/` on the remote host.

### Browser / Preview / Updates

- `hostPreviewService.ts` installs deps and starts a project-local preview server from the task/worktree, can link parent `node_modules`, and emits URL/setup events.
- `browserViewService.ts` manages the embedded browser pane.
- `AutoUpdateService.ts` wraps `electron-updater`, staged channels, manual download/install flow, and restart guards.
- `ChangelogService.ts` fetches and normalizes release/changelog content for the in-app changelog UI.

## Database And Migrations

- Schema: `src/main/db/schema.ts`
- Drizzle client/path helpers: `src/main/db/`
- Migrations: `drizzle/`
- Generate migrations with `pnpm exec drizzle-kit generate`
- Browse with `pnpm exec drizzle-kit studio`

Database paths:

- macOS: `~/Library/Application Support/emdash/emdash.db`
- Linux: `~/.config/emdash/emdash.db`
- Windows: `%APPDATA%\\emdash\\emdash.db`

`EMDASH_DB_FILE` overrides the database path.

`DatabaseService.initialize()` validates schema invariants and can force a local reset flow when the on-disk schema is incompatible. Treat migration changes carefully.

## Docs App

The `docs/` directory is a separate app:

- framework: Next.js + Fumadocs
- scripts: `pnpm run docs`, `pnpm run docs:build`
- content: `docs/content/docs/*.mdx`
- config/types: `docs/package.json`, `docs/tsconfig.json`

When changing user-facing behavior, update the relevant docs page if there is one. Current docs topics include tasks, issues, providers, project config, diff view, file editor, kanban, skills, MCP, CI checks, remote projects, tmux sessions, changelog, telemetry, and contributing.

## Code Style

- TypeScript strict mode is enabled in both app tsconfigs.
- Prefer explicit types over `any`; use `import type` where possible.
- Renderer code is functional React with hooks and context providers.
- Components use PascalCase filenames. Hooks use `useX` camelCase or existing kebab-case patterns like `use-toast.ts`.
- Main-process errors go through `log.error()` or related logger calls.
- Renderer errors typically use `console.error()` and/or toasts.
- Tailwind is the default styling approach in the app.

## Environment Variables

App/runtime env vars:

- `EMDASH_DB_FILE`
- `EMDASH_DISABLE_NATIVE_DB`
- `EMDASH_DISABLE_CLONE_CACHE`
- `EMDASH_DISABLE_PTY`
- `TELEMETRY_ENABLED`
- `CODEX_SANDBOX_MODE`
- `CODEX_APPROVAL_POLICY`

Agent auth env vars are intentionally allowlisted in `src/main/services/ptyManager.ts`. If a provider or integration needs a new credential passed through to spawned CLIs, add it there explicitly.

## Hot Reload

- Renderer changes hot-reload through Vite.
- Main-process changes require restarting Electron.
- Native module changes require `pnpm run rebuild`.
- Docs changes hot-reload through Next.js when using `pnpm run docs`.

## CI / CD

Current GitHub Actions workflows:

- `code-consistency-check.yml`: format check, type-check, Vitest on PRs
- `release.yml`: macOS, Linux release packaging and publishing
- `nix-build.yml`: Nix package build
- `windows-beta-build.yml`: Windows beta packaging workflow

Release/build notes:

- macOS and Linux release jobs rebuild native modules for the target Electron version.
- Windows beta builds intentionally use Node 20 in CI for better native module stability even though local development is on Node 22.
- Packaging targets include macOS desktop builds, Linux AppImage/deb/rpm, and Windows NSIS/MSI outputs.

## Common Pitfalls

1. PTY cleanup is easy to get wrong. Always confirm exit handlers remove PTYs and related tmux state.
2. `@/*` means different things in main and renderer. Check the relevant tsconfig before moving files.
3. Every new IPC method needs renderer type declarations in `src/renderer/types/electron-api.d.ts`.
4. Worktree paths should come from service helpers, not ad hoc path math.
5. Shell quoting matters, especially for SSH, lifecycle scripts, and provider hooks.
6. Host preview runs from task/worktree directories, not necessarily the repo root. Watch for missing deps and port assumptions.
7. The docs app is a separate Next.js project with its own dependency tree and port usage.
8. Provider integrations often require touching both the registry and the PTY env allowlist.
9. If an agent cannot find `gh`, `codex`, or similar binaries, inspect the PATH bootstrapping in `src/main/main.ts`.

## Risky Areas

- `src/main/db/**` and `drizzle/`
- `src/main/services/ptyManager.ts`
- `src/main/services/ssh/**`
- `src/main/utils/shellEscape.ts`
- `src/main/services/AutoUpdateService.ts`
- `build/` entitlements and updater config
- native dependency versions and rebuild flow

## Git Workflow

- Agent worktrees typically live under `../worktrees/{task-name}-{hash}`.
- Branch prefixes default to `emdash` and are configurable in app settings.
- Conventional commit prefixes are preferred: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`.

## Key Configuration Files

- `package.json`
- `vite.config.ts`
- `tsconfig.json`
- `tsconfig.main.json`
- `drizzle.config.ts`
- `flake.nix`
- `tailwind.config.js`
- `.nvmrc`
- `.emdash.json`
- `.husky/`
- `.github/workflows/*.yml`

## Pre-PR Checklist

- `pnpm run dev` or `pnpm run d` starts cleanly for the area you changed.
- `pnpm run format` passes or leaves no unwanted formatting diffs.
- `pnpm run lint` passes.
- `pnpm run type-check` passes.
- `pnpm exec vitest run` passes.
- Any changed behavior has matching test coverage.
- Any user-facing workflow or configuration change is reflected in `docs/` when appropriate.
- No build artifacts, secrets, or accidental generated files are included.
