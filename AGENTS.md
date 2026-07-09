# Project Overview

Emdash is a local-first, cross-platform Electron app for running multiple AI coding
agents in parallel. Each task is isolated in its own Git worktree and can run locally
or over SSH, while the desktop app coordinates provider CLIs, ACP chat sessions,
terminal sessions, issue and PR integrations, diff review, and release packaging.

## Repository Structure

This is a pnpm workspace monorepo. The Electron app lives in
`apps/emdash-desktop/` as `@emdash/emdash-desktop`; shared packages live under
`packages/`. Unless a path is prefixed with `packages/` or another app, app paths
such as `src/...`, `drizzle/`, `scripts/`, and `build/` are relative to
`apps/emdash-desktop/`.

Repo root:

- `.claude/` - Local Claude agent settings for this checkout.
- `.github/` - GitHub issue templates, reusable actions, CI, and release workflows.
- `agents/` - Agent-facing architecture, workflow, convention, integration, and risk docs.
- `apps/emdash-desktop/` - The Electron desktop app.
- `packages/chat-ui/` - Shared transcript and ACP chat renderer with Storybook coverage.
- `packages/core/` - Transport-agnostic runtime primitives, including ACP session logic.
- `packages/plugins/` - Agent provider plugin definitions, hooks, and ACP adapters.
- `packages/shared/` - Shared primitives such as result types, logging, and markdown helpers.
- `packages/ui/` - Shared React UI components, theme tokens, recipes, and primitives.
- `pnpm-workspace.yaml` - Workspace package globs for `apps/*` and `packages/**`.
- Root config files - `package.json`, `nx.json`, `.nvmrc`, `.oxfmtrc.json`,
  `.oxlintrc.json`, and lockfile/configuration owned at the workspace root.

Inside `apps/emdash-desktop/`:

- `build/` - Electron packaging assets; avoid edits unless working on packaging/signing.
- `drizzle/` - Generated Drizzle SQL migrations and metadata.
- `scripts/` - Release, verification, and build support scripts.
- `src/main/` - Electron main process, RPC controllers, services, DB, ACP, PTY, and SSH.
- `src/preload/` - Typed Electron preload bridge exposed to the renderer.
- `src/renderer/` - React app organized around `app/`, `features/`, `lib/`, and tests.
- `src/shared/` - App IPC primitives, provider metadata, events, ACP, MCP, skills, and types.
- `src/types/` - Ambient and cross-cutting TypeScript declarations.
- `tooling/` - App-level development and test infrastructure not bundled into production.

## Build & Development Commands

Use Node `24.14.0` from `.nvmrc` and `pnpm@10.28.2`. Root scripts are powered by Nx
and run package targets in dependency order with local caching where configured.

Install dependencies from the repo root:

```bash
pnpm install
```

Start the full workspace dev setup from the repo root:

```bash
pnpm run dev
```

Start only the Electron app from `apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run dev
pnpm run d
```

Run main-process or renderer-only dev watches from `apps/emdash-desktop/`:

```bash
pnpm run dev:main
pnpm run dev:renderer
```

Run with debug logging from `apps/emdash-desktop/`:

```bash
pnpm run dev:debug
```

Use an isolated development database for schema or migration work:

```bash
EMDASH_DB_FILE=/tmp/emdash-scratch.db pnpm run dev
```

Reset dev databases from `apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run db:reset
```

Build all workspace projects from the repo root:

```bash
pnpm run build
```

Build only the app targets from `apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run build
pnpm run build:main
pnpm run build:renderer
```

Package desktop artifacts locally from `apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run package
pnpm run package:mac
pnpm run package:linux
pnpm run package:win
```

Run formatting, linting, type checks, and tests from the repo root:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```

Run focused database validation from `apps/emdash-desktop/`:

```bash
pnpm run db:setup
pnpm run db:fixtures
pnpm run test:migrations
```

Run Docker-backed SSH development infrastructure from `apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run run:docker-ssh
```

Run Storybook for shared UI packages:

```bash
pnpm --filter @emdash/ui run storybook
pnpm --filter @emdash/chat-ui run storybook
```

Rebuild native Electron dependencies after native dependency changes from
`apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run rebuild
```

Clean and reset app dependencies from `apps/emdash-desktop/`:

```bash
cd apps/emdash-desktop
pnpm run clean
pnpm run reset
```

Deploy releases only when explicitly asked to do release work:

```bash
gh workflow run release-prod.yml --ref main -f arch=both
gh workflow run release-canary.yml --ref main -f arch=both
```

Production releases publish artifacts to GitHub Releases and Cloudflare R2. Canary
releases currently publish to R2 only.

## Code Style & Conventions

- Use `pnpm`; do not introduce npm or yarn lockfile churn.
- Format with `oxfmt`; config is `.oxfmtrc.json`.
- Keep formatted lines near the configured `printWidth` of 100 characters.
- Use 2 spaces, semicolons, single quotes in TS, double quotes in JSX, LF endings,
  trailing commas where valid in ES5, and sorted imports.
- Lint with `oxlint`; config is `.oxlintrc.json` with correctness, TypeScript, React
  hooks, and local repo rules enabled.
- TypeScript strict mode is enabled; app targets share `apps/emdash-desktop/tsconfig.json`.
- Avoid `any`; if a registry or boundary needs it, keep the escape local and documented.
- Use top-level `import` statements; do not use `require()`.
- Never re-export as a shortcut; import from the original source.
- Components use `PascalCase`; hooks use `useX` camelCase or an existing local pattern.
- Tests use `*.test.ts` or `*.test.tsx`.
- Main-process RPC handlers live in `src/main/core/*/controller.ts` and delegate to
  imported operation or service functions.
- Renderer RPC calls go through `rpc` from `src/renderer/lib/ipc.ts`.
- Feature UI lives under `src/renderer/features/<feature>/`; shared renderer primitives,
  stores, hooks, modals, PTY, Monaco, and UI live under `src/renderer/lib/`.
- New modals must be registered in `src/renderer/app/modal-registry.ts`.
- New views must be registered in `src/renderer/app/view-registry.ts`.
- New task tabs should use `src/renderer/features/tasks/task-tab-registry.tsx`.
- New commands should use `src/renderer/lib/commands/registry.ts` and view-level
  `commandProvider` hooks where possible.
- Commit messages should follow Conventional Commits:

```text
<type>(<scope>): <short imperative summary>

Examples:
fix(opencode): change initialPromptFlag from -p to --prompt for TUI
feat(docs): add changelog tab with GitHub releases integration
```

## Architecture Notes

```mermaid
flowchart LR
  User[User] --> Renderer[React renderer]
  Renderer --> RPC[Typed RPC client and events]
  RPC --> Preload[Electron preload bridge]
  Preload --> Main[Electron main process]
  Main --> Controllers[src/main/core controllers]
  Controllers --> Services[Domain services]
  Services --> DB[(SQLite via Drizzle)]
  Services --> Runtime[Runtime services]
  Runtime --> PTY[PTY sessions]
  Runtime --> ACP[ACP sessions]
  Runtime --> SSH[SSH and SFTP]
  Services --> VCS[Git, GitHub, GitLab, PRs]
  Services --> Issues[Issue integrations]
  Services --> MCP[MCP and skills]
  ACP --> CoreAcp[@emdash/core ACP runtime]
  ACP --> Plugins[@emdash/plugins providers]
  Renderer --> ChatUI[@emdash/chat-ui]
  Main --> Events[Typed events]
  Events --> Renderer
```

The app boots from `src/main/index.ts`, loads environment and database state,
registers RPC controllers through `src/main/rpc.ts`, creates the Electron window,
and exposes a small typed preload API from `src/preload/index.ts`. The renderer is
a React app that calls typed RPC methods, subscribes to typed events, and coordinates
views, tabs, modals, command providers, project state, terminal state, and task
workflows.

Task execution has two runtime paths. Legacy/TUI conversations run through PTY
services under `src/main/core/pty/` and `src/main/core/terminals/`. Structured chat
conversations use ACP: provider plugins in `packages/plugins/` expose ACP behavior,
`packages/core/src/acp/` owns protocol/session state and terminal management,
`src/main/core/acp/` adapts that runtime to Electron RPC/events and local/SSH process
hosts, and `src/renderer/features/conversations/acp/` maps updates into `@emdash/chat-ui`.

Major main-process domains live under `src/main/core/`: account, ACP, agents,
agent hooks, app, automations, browser, conversations, dependencies, editor,
filesystem, Git, GitHub, GitLab, integrations, MCP, preview servers, projects,
project setup, prompt library, PTY, pull requests, resource monitor, runtime, search,
secrets, settings, skills, SSH, tasks, telemetry, terminal shell, terminals, updates,
view state, and workspaces. Expected failures should use the `Result<T, E>` pattern
from `@emdash/shared` or the app-local result helpers.

## Testing Strategy

Local merge gate:

```bash
pnpm run format
pnpm run lint
pnpm run typecheck
pnpm run test
```

- Root `pnpm run test` uses Nx to run every workspace package test target.
- App tests run with Vitest projects in `apps/emdash-desktop/vitest.config.ts`.
- App `node` tests cover `src/**/*.test.ts` except DB, migration, and browser tests.
- App `main-db` tests cover main-process integration tests that need real SQLite.
- App `fixtures` tests generate DB fixtures via `pnpm run db:fixtures`.
- App `migrations` tests validate Drizzle migrations via `pnpm run test:migrations`.
- App `scripts` tests cover release and support scripts under `scripts/**/*.test.ts`.
- App `browser` tests use Playwright-backed `@vitest/browser` for renderer behavior.
- `packages/core` has ACP, dependency, plugin helper, Git, FS, and runtime unit tests.
- `packages/chat-ui` has node, browser, perf, and benchmark test targets.
- `packages/ui`, `packages/shared`, and `packages/plugins` run their package-local tests.
- Integration-style tests create temporary repos and worktrees in `os.tmpdir()`.
- CI runs `.github/workflows/code-consistency-check.yml` with `nx affected` for
  `format:check`, `typecheck`, and `lint` on touched projects and dependents.
- Tests are still expected locally before merge even where CI coverage is narrower.

## Security & Compliance

- The project is licensed under Apache-2.0; see `LICENSE.md`.
- Do not commit secrets, tokens, private keys, app databases, logs, build artifacts,
  generated dependency folders, or release artifacts.
- Application secrets are stored through encrypted app secret services and Electron
  safe storage; SSH credentials are managed through SSH services and OS-backed storage.
- Release secrets live in GitHub Actions secrets, including PostHog, Cloudflare R2,
  Apple signing/notarization, Azure Trusted Signing, and Cachix credentials.
- Telemetry must remain optional; users can disable it with `TELEMETRY_ENABLED=false`
  or in app settings.
- File logging must preserve redaction of common secret patterns.
- PTY environment passthrough must use the allowlist in `src/main/core/pty/pty-env.ts`.
- Treat ACP process spawning, SSH command construction, shell escaping, PTY spawning,
  and worktree paths as security-sensitive.
- Do not bypass path-safety, shell escaping, or validation helpers.
- Use `pnpm-lock.yaml` for dependency integrity and review dependency changes.
- This checkout does not define repo-local Dependabot config, CODEOWNERS, or SECURITY.md;
  do not assume extra repository-owned security automation beyond the workflows present
  in `.github/workflows/`.
- Dependency changes must keep `pnpm-lock.yaml` in sync, preserve `packageManager` and
  `pnpm.onlyBuiltDependencies`, and avoid introducing new install scripts or native
  builds without explicit review.
- CI installs with `pnpm install --frozen-lockfile --ignore-scripts` in
  `.github/workflows/code-consistency-check.yml`; changes that rely on install-time
  side effects need clear justification.
- Prefer existing dependencies and workspace packages over adding new third-party
  packages. When adding a dependency, document why the existing stack is insufficient
  and check license/security posture before committing the lockfile change.

## Agent Guardrails

- Start with this file for repo-wide context and required commands.
- Load only the relevant `agents/` topic page for the area you are changing.
- Prefer updating the smallest applicable `agents/` page over expanding this file.
- If nested `AGENTS.md` files are added later, the closest file to the edited path wins.
- Explicit user or maintainer instructions override this file.
- Do not hand-edit numbered Drizzle migrations or `drizzle/meta/`.
- Use `pnpm run db:generate` for new migrations, then update fixtures and migration tests.
- Avoid editing `dist/`, `release/`, `out/`, `build/`, and generated package artifacts
  unless the task is explicitly about packaging, signing, or release behavior.
- Do not dispatch release workflows, publish packages, upload artifacts, or trigger
  external deployments unless the user explicitly asks for release work.
- Treat `src/main/core/acp/`, `src/main/core/pty/`, `src/main/core/ssh/`,
  `src/main/db/`, updater code, and provider process spawning as high risk.
- Read the matching `agents/risky-areas/` page before touching database, PTY, SSH, or
  updater code.
- Do not weaken shell quoting, spawn behavior, env allowlists, path validation, or
  secret redaction casually.
- Prefer existing service, provider, plugin, RPC, modal, view, tab, and store patterns
  over new abstractions.
- New RPC methods belong in the appropriate `src/main/core/*/controller.ts` and must be
  registered through `src/main/rpc.ts`.
- Keep renderer-main calls on typed RPC and typed events. The preload bridge should stay
  small; add direct `window.electronAPI` surface only when an Electron/browser primitive
  cannot fit the RPC/event path.
- Access task and project MobX stores through selectors and task view hooks:
  `getTaskStore`, `asProvisioned`, `taskViewKind`, `getTaskManagerStore`,
  `getProjectStore`, `asMounted`, `useTaskViewKind`, `useWorkspace`,
  `useWorkspaceId`, `useDevServers`, `useWorkspaceViewModel`, `useConversations`,
  and `useTerminals`.
- Never use `asProvisioned(...)!` or `asMounted(...)!`; use explicit null checks.
- State guards must check `kind !== 'ready'` rather than enumerating non-ready states.
- Access task managers through `getTaskManagerStore(projectId)`, not `project.taskManager`.
- Access mounted projects through `asMounted(getProjectStore(id))`, not inline guards.
- Task selectors live in `src/renderer/features/tasks/stores/task-selectors.ts`.
- Project selectors live in `src/renderer/features/projects/stores/project-selectors.ts`.
- For provider changes, update plugin metadata, shared provider metadata, ACP support
  flags, PTY env passthrough if needed, hook integrations, renderer assumptions, and
  tests for non-standard behavior.
- For ACP changes, preserve protocol state-machine behavior in `packages/core/src/acp/`,
  keep provider-specific transforms in `packages/plugins/`, and adapt UI payloads at
  app or chat-UI edges.
- For MCP changes, keep canonical data in shared types and adapt provider formats at edges.
- Follow `.github/PULL_REQUEST_TEMPLATE.md`: keep PRs small and focused, self-review
  before handoff, list checks run, attach UI evidence when applicable, and update docs
  and tests when behavior changes.
- Call out high-risk changes explicitly in the PR description or handoff notes,
  especially database, ACP, PTY, SSH, updater, provider spawning, dependency, and
  release-related changes.
- Do not self-approve, merge, assign reviewers, edit branch protection, or change
  workflow permissions unless the user explicitly asks.
- Avoid scripted loops against GitHub, Linear, Jira, GitLab, provider CLIs, or release
  workflows. Use focused queries and respect existing workflow retries; ask before
  adding polling, bulk API calls, or scheduled automation.
- Keep automation scoped to the task. Do not run the full local merge gate repeatedly
  when a focused check is enough during iteration; run broader checks before handoff
  when the change scope justifies it.

## Extensibility Hooks

- Agent provider plugins live in `packages/plugins/src/agents/impl/` and are registered
  in `packages/plugins/src/agents/registry.ts`.
- Provider capabilities and helpers live in `packages/core/src/agents/plugins/`.
- Agent provider metadata and capabilities live in `packages/plugins/src/agents/registry.ts`
  and `packages/plugins/src/agents/impl/`; renderer-facing DTOs are built by
  `src/main/core/agents/agent-payload-builder.ts`.
- ACP support is exposed through plugin ACP capabilities and `src/shared/core/acp/`
  event and turn types.
- Provider detection lives in `src/main/core/dependencies/`.
- Provider PTY behavior and env passthrough live under `src/main/core/pty/`.
- Provider event hooks and plugins live under `src/main/core/agent-hooks/`.
- ACP process hosts live under `src/main/core/acp/transport/` for local and SSH-backed
  execution.
- Modal definitions are centralized in `src/renderer/app/modal-registry.ts`.
- View definitions and navigation guards are centralized in `src/renderer/app/view-registry.ts`.
- Task tab providers are centralized in `src/renderer/features/tasks/task-tab-registry.tsx`.
- MCP server config handling lives in `src/main/core/mcp/services/McpService.ts`,
  `src/main/core/mcp/utils/`, `src/shared/core/mcp/`, and `src/renderer/features/mcp/`.
- Skills types and validation live under `src/shared/core/skills/`; skills UI and
  service code live in `src/renderer/features/skills/` and `src/main/core/skills/`.
- Worktree runtime settings can be supplied through `.emdash.json`:
  `preservePatterns`, `scripts.setup`, `scripts.run`, `scripts.teardown`, and
  `shellSetup`.
- Project settings such as `worktreeDirectory`, `defaultBranch`, `baseRemote`,
  `pushRemote`, `tmux`, and `workspaceProvider` are DB-backed, not `.emdash.json`.
- Optional environment variables include `TELEMETRY_ENABLED`, `EMDASH_DB_FILE`,
  `EMDASH_DISABLE_NATIVE_DB`, `EMDASH_DISABLE_CLONE_CACHE`, `EMDASH_DISABLE_PTY`,
  `CODEX_SANDBOX_MODE`, and `CODEX_APPROVAL_POLICY`.
- Build-time telemetry configuration may use `VITE_POSTHOG_KEY` and `VITE_POSTHOG_HOST`.
- Runtime feature flags are read through telemetry-backed feature flag helpers.
- App path aliases are defined in `tsconfig.json` and mirrored in `electron.vite.config.ts`:
  `@/*`, `@renderer/*`, `@main/*`, `@shared/*`, `@root/*`, and `@tooling/*`.
- Versioned JSON column schemas use `defineVersionedSchema()` from
  `src/shared/lib/versioned-schema/versioned-schema.ts` and Drizzle
  `versionedJsonColumn()` from `src/main/db/versioned-column.ts`.

## Further Reading

- [Agent docs map](agents/README.md)
- [Quickstart](agents/quickstart.md)
- [Architecture overview](agents/architecture/overview.md)
- [Main process architecture](agents/architecture/main-process.md)
- [Renderer architecture](agents/architecture/renderer.md)
- [Shared modules](agents/architecture/shared.md)
- [Nx task orchestration and caching](agents/workflows/nx.md)
- [Testing workflow](agents/workflows/testing.md)
- [Worktrees workflow](agents/workflows/worktrees.md)
- [Remote development workflow](agents/workflows/remote-development.md)
- [Workspace server architecture](agents/architecture/workspace-server.md)
- [Provider integration](agents/integrations/providers.md)
- [MCP integration](agents/integrations/mcp.md)
- [IPC conventions](agents/conventions/ipc.md)
- [Main-process patterns](agents/conventions/main-patterns.md)
- [Renderer patterns](agents/conventions/renderer-patterns.md)
- [TypeScript and React conventions](agents/conventions/typescript.md)
- [Config file rules](agents/conventions/config-files.md)
- [UI styling conventions](agents/conventions/ui-styling.md)
- [Versioned schema conventions](agents/conventions/versioned-schemas.md)
- [Database risk notes](agents/risky-areas/database.md)
- [PTY risk notes](agents/risky-areas/pty.md)
- [SSH risk notes](agents/risky-areas/ssh.md)
- [Updater risk notes](agents/risky-areas/updater.md)
- [Contributing guide](CONTRIBUTING.md)
- [Project README](README.md)
