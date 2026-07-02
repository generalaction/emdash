# Main Process

## Structure

The main process is organized into domain modules under `src/main/core/`. Each domain typically has a `controller.ts` (RPC handlers) and service/implementation files.

## Domain Modules (`src/main/core/`)

This list covers the primary domains; it is not exhaustive — run `ls src/main/core/` for
the full current set (integration domains like `jira`, `linear`, `asana`, `trello`, `plane`,
`plain`, `monday`, `forgejo`, and smaller domains like `secrets`, `telemetry`,
`view-state`, `search`, `port-forwards` follow the same controller/service pattern).

- **account** — Emdash account service, credential store, provider token registry
- **acp** — ACP session manager, controller, and local/SSH transport hosts for the
  structured-chat runtime; see `agents/integrations/acp.md`
- **agent-hooks** — HTTP hook server for agent callbacks, event enrichment, OS notifications, hook/plugin config writer
- **agents** — plugin registry adapter (`plugin-registry.ts`), agent payload builder, workspace trust
- **app** — App lifecycle service and controller
- **conversations** — Conversation CRUD and session start
- **dependencies** — CLI agent detection, probing, dependency management
- **editor** — Editor buffer service for Monaco integration
- **files** — Filesystem operations (`file-system/`, `file-tree/`, `browse-directory.ts`,
  `path-utils.ts`, `realpath-containment.ts`); SSH-backed filesystem access lives under
  `runtime/legacy/ssh-file-system.ts`, not here
- **git** — Git operations (`git-service.ts`, `git-repo-utils.ts`, `detectGitInfo.ts`)
- **github** — GitHub auth, PRs, issues, repos (via `gh` CLI)
- **gitlab** — GitLab connection service and issue provider
- **issues** — issue provider registry and Git-remote-based issue resolution shared across trackers
- **jira** — Jira integration
- **linear** — Linear integration
- **mcp** — MCP service; provider-specific adapters live in each provider's plugin, see `agents/integrations/mcp.md`
- **preview-servers** — dev/preview server lifecycle and terminal URL detection
- **projects** — Project management with provider pattern (`local-project-provider.ts`), worktree service, project settings, CRUD operations
- **pty** — PTY lifecycle (`local-pty.ts`, `ssh2-pty.ts`), session registry, env setup, spawn utilities
- **repository** — Repository controller
- **resource-monitor** — resource sampling and controller
- **runtime** — runtime/workspace health manager; `legacy/` holds SSH filesystem
  (`ssh-file-system.ts`, `ssh-legacy-fs.ts`) and SSH-git implementations
- **settings** — App settings service and schema, provider settings (separate controller)
- **shared** — Shared utilities (OAuth flow)
- **skills** — Skills service and controller
- **ssh** — SSH connection management (`config/`, `connect/`, `credentials/`, `lifecycle/`), see `agents/risky-areas/ssh.md`
- **tasks** — Task CRUD (create, delete, archive, restore, provision)
- **terminals** — Terminal lifecycle with provider pattern (`local-terminal-provider.ts`, `ssh-terminal-provider.ts`), lifecycle scripts
- **updates** — Auto-update service
- **workspaces** — workspace registry, lifecycle, factory, BYOI and setup-step providers

## Other Main Process Areas

- `src/main/app/` — Menu, protocol handler, window creation
- `src/main/lib/` — Logger, telemetry, events, retry/rate-limit helpers
  (Result type lives in `packages/shared/src/result/`, imported as `@emdash/shared`;
  updater-specific error helpers live under `src/main/core/updates/`)
- `src/main/db/` — Database schema and initialization
- `src/main/utils/` — Shell environment, shell escaping, child process env, external links
- `src/main/core/agent-hooks/` — Hook server, event enrichment, OS notifications, hook/plugin config writer

## IPC / RPC Structure

- All domain controllers are assembled into a typed RPC router in `src/main/rpc.ts`.
- RPC primitives live in `src/shared/lib/ipc/rpc.ts` (`createRPCRouter`, `createRPCController`, `createRPCClient`).
- Event primitives live in `src/shared/lib/ipc/events.ts`.
- The preload bridge (`src/preload/index.ts`) exposes only `invoke`, `eventSend`, `eventOn`, and `getPathForFile`; there are no other manual IPC handlers.

## When Editing Here

- Check `agents/conventions/main-patterns.md` for controller, service, Result type, and event patterns.
- Check `agents/conventions/ipc.md` for the RPC controller pattern and typing rules.
- Check `agents/risky-areas/pty.md` before touching PTY or provider spawn behavior.
- Check `agents/risky-areas/database.md` before changing persistence or migrations.
