---
default_branch: main
package_manager: pnpm
node_version: "22.20.0"
start_command: "pnpm run d"
dev_command: "pnpm run dev"
build_command: "pnpm run build"
test_commands:
  - "pnpm run format:check"
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

Cross-platform Electron app that orchestrates multiple CLI coding agents (Claude Code, Codex, Qwen Code, Amp, etc.) in parallel. Each agent runs in its own Git worktree for isolation. Also supports remote development over SSH.

### Tech Stack

- **Runtime**: Electron 30.5.1, Node.js >=20.0.0 <23.0.0 (recommended: 22.20.0 via `.nvmrc`)
- **Frontend**: React 18, TypeScript 5.3, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, TypeScript, Drizzle ORM 0.32, SQLite3 5.1
- **Editor**: Monaco Editor 0.55, **Terminal**: @xterm/xterm 6.0 + node-pty 1.0
- **Native Modules**: node-pty, sqlite3, keytar 7.9 (require `pnpm run rebuild` after updates)
- **SSH**: ssh2 1.17
- **UI**: Radix UI primitives, lucide-react icons, framer-motion

## Quickstart

1. `nvm use` (installs Node 22.20.0 if missing) or install Node 22.x manually.
2. `pnpm run d` to install dependencies and launch Electron + Vite.
3. If `pnpm run d` fails mid-stream, rerun `pnpm install`, then `pnpm run dev` (main + renderer).

## Development Commands

```bash
# Quick start (installs deps, starts dev)
pnpm run d

# Development (runs main + renderer concurrently)
pnpm run dev
pnpm run dev:main     # Electron main process only (tsc + electron)
pnpm run dev:renderer # Vite dev server only (port 3000)

# Quality checks (ALWAYS run before committing)
pnpm run format       # Format with Prettier
pnpm run lint         # ESLint
pnpm run type-check   # TypeScript type checking (uses tsconfig.json — renderer/shared/types)
pnpm exec vitest run  # Run all tests

# Run a specific test
pnpm exec vitest run src/test/main/WorktreeService.test.ts

# Native modules
pnpm run rebuild      # Rebuild native modules for Electron
pnpm run reset        # Clean install (removes node_modules, reinstalls)

# Building & Packaging
pnpm run build        # Build main + renderer
pnpm run package:mac  # macOS .dmg (arm64)
pnpm run package:linux # Linux AppImage/deb (x64)
pnpm run package:win  # Windows nsis/portable (x64)
```

## Testing

Tests use `vi.mock()` to stub `electron`, `DatabaseService`, `logger`, etc. Integration tests create real git repos in `os.tmpdir()`. No shared test setup file — mocks are per-file.

- **Framework**: Vitest (configured in `vite.config.ts`, `environment: 'node'`)
- **Test locations**: `src/test/main/` (15 service tests), `src/test/renderer/` (3 UI tests), `src/main/utils/__tests__/` (2 utility tests)

## Guardrails

- **ALWAYS** run `pnpm run format`, `pnpm run lint`, `pnpm run type-check`, and `pnpm exec vitest run` before committing.
- **NEVER** modify `drizzle/meta/` or numbered migration files — always use `drizzle-kit generate`.
- **NEVER** modify `build/` entitlements or updater config without review.
- **ALWAYS** use feature branches (never commit directly to `main`).
- Do work on branches or worktrees; default branch is `main`, never push directly.
- Do limit edits to `src/**`, `docs/**`, or config files you fully understand; keep `dist/`, `release/`, and `build/` untouched.
- Don't modify telemetry defaults or updater logic unless intentional and reviewed.
- Don't run commands that mutate global environments (global package installs, git pushes) from agent scripts.
- Put temporary notes or scratch content in `.notes/` (gitignored).

## Architecture

### Process Model

- **Main process** (`src/main/`): Electron main — IPC handlers, services, database, PTY management
- **Renderer process** (`src/renderer/`): React UI built with Vite — components, hooks, terminal panes
- **Shared** (`src/shared/`): Provider registry (21 agent definitions), PTY ID helpers, shared utilities

### Boot Sequence

`entry.ts` → `main.ts` → IPC registration → window creation

- `entry.ts` — Sets app name (must happen before `app.getPath('userData')`, or Electron defaults to `~/Library/Application Support/Electron`). Monkey-patches `Module._resolveFilename` to resolve `@shared/*` and `@/*` path aliases at runtime in compiled JS.
- `main.ts` — Loads `.env`, fixes PATH for CLI discovery on macOS/Linux/Windows (adds Homebrew, npm global, nvm paths so agents like `gh`, `codex`, `claude` are found when launched from Finder), detects `SSH_AUTH_SOCK` from user's login shell, then initializes Electron windows and registers all IPC handlers.
- `preload.ts` — Exposes secure `electronAPI` to renderer via `contextBridge`.

### Main Process (`src/main/`)

**Key services** (`src/main/services/`):
- `WorktreeService.ts` — Git worktree lifecycle, file preservation patterns
- `WorktreePoolService.ts` — Worktree pooling/reuse for instant task starts
- `DatabaseService.ts` — All SQLite CRUD operations
- `ptyManager.ts` — PTY (pseudo-terminal) lifecycle, session isolation, agent spawning
- `SkillsService.ts` — Cross-agent skill installation and catalog management
- `GitHubService.ts` / `GitService.ts` — Git and GitHub operations via `gh` CLI
- `PrGenerationService.ts` — Automated PR generation
- `TaskLifecycleService.ts` — Task lifecycle orchestration
- `TerminalSnapshotService.ts` — Terminal state snapshots
- `TerminalConfigParser.ts` — Terminal configuration parsing
- `RepositoryManager.ts` — Repository management
- `RemotePtyService.ts` / `RemoteGitService.ts` — Remote development over SSH
- `ssh/` — SSH connection management, credentials (via keytar), host key verification

Note: Some IPC handler files are colocated in `services/` (e.g., `worktreeIpc.ts`, `ptyIpc.ts`, `updateIpc.ts`, `lifecycleIpc.ts`, `planLockIpc.ts`, `fsIpc.ts`).

**IPC Handlers** (`src/main/ipc/`):
- 25+ handler files total (19 in `ipc/` + 6 colocated in `services/`) covering app, db, git, github, browser, connections, project, settings, telemetry, SSH, Linear, Jira, skills, and more
- All return `{ success: boolean, data?: any, error?: string }` format
- Types defined in `src/renderer/types/electron-api.d.ts` (~1,870 lines)

**Database** (`src/main/db/`):
- Schema: `schema.ts` — Migrations: `drizzle/` (auto-generated)
- Locations: macOS `~/Library/Application Support/emdash/emdash.db`, Linux `~/.config/emdash/emdash.db`, Windows `%APPDATA%\emdash\emdash.db`
- Override with `EMDASH_DB_FILE` env var

### Renderer Process (`src/renderer/`)

**Key components** (`components/`):
- `App.tsx` — Root orchestration (~790 lines), located at `src/renderer/App.tsx`
- `EditorMode.tsx` — Monaco code editor
- `ChatInterface.tsx` — Conversation UI
- `FileChangesPanel.tsx` / `ChangesDiffModal.tsx` — Diff visualization and review
- `CommandPalette.tsx` — Command/action palette
- `FileExplorer/` — File tree navigation
- `BrowserPane.tsx` — Webview preview
- `skills/` — Skills catalog and management UI
- `ssh/` — SSH connection UI components

**Key hooks** (`hooks/`, 42 total):
- `useAppInitialization` — Two-round project/task loading (fast skeleton then full), restores last active project/task from localStorage
- `useTaskManagement` — Full task lifecycle (~864 lines): create, delete, rename, archive, restore. Handles optimistic UI removal with rollback, lifecycle teardown, PTY cleanup
- `useCliAgentDetection` — Detects which CLI agents are installed on the system
- `useInitialPromptInjection` / `usePendingInjection` — Manages initial prompt sent to agents on task start

### Path Aliases

**Important**: `@/*` resolves differently in main vs renderer:

| Alias | tsconfig.json (renderer) | tsconfig.main.json (main) |
|-------|-------------------------|--------------------------|
| `@/*` | `src/renderer/*` | `src/*` |
| `@shared/*` | `src/shared/*` | `src/shared/*` |
| `#types/*` | `src/types/*` | _(not available)_ |
| `#types` | `src/types/index.ts` | _(not available)_ |

At runtime in compiled main process, `entry.ts` monkey-patches `Module._resolveFilename` to map `@shared/*` → `dist/main/shared/*` and `@/*` → `dist/main/main/*`.

Main uses `module: "CommonJS"` (required by Electron), renderer uses `module: "ESNext"` (Vite handles compilation).

### IPC Pattern

```typescript
// Main (src/main/ipc/exampleIpc.ts)
ipcMain.handle('example:action', async (_event, args) => {
  try {
    return { success: true, data: await service.doSomething(args) };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Renderer — call via window.electronAPI
const result = await window.electronAPI.exampleAction({ id: '123' });
```

All new IPC methods must be declared in `src/renderer/types/electron-api.d.ts`.

### Services

Singleton classes with module-level export:
```typescript
export class ExampleService { /* ... */ }
export const exampleService = new ExampleService();
```

## Provider Registry (`src/shared/providers/registry.ts`)

All 21 CLI agents are defined as `ProviderDefinition` objects. Key fields:

- `cli` — binary name, `commands` — detection commands (may differ from cli)
- `autoApproveFlag` — e.g. `--dangerously-skip-permissions` for Claude
- `initialPromptFlag` — how to pass the initial prompt (`-i`, positional, etc.)
- `useKeystrokeInjection` — `true` for agents with no CLI prompt flag (Amp, OpenCode); Emdash types the prompt into the TUI after startup
- `sessionIdFlag` — only Claude; enables multi-chat session isolation via `--session-id`
- `resumeFlag` — e.g. `-c -r` for Claude, `--continue` for Kilocode

To add a new provider: add a definition here AND add any API key to the `AGENT_ENV_VARS` list in `ptyManager.ts`.

## PTY Management (`src/main/services/ptyManager.ts`)

Three spawn modes:
1. **`startPty()`** — Shell-based: `{cli} {args}; exec {shell} -il` (user gets a shell after agent exits)
2. **`startDirectPty()`** — Direct spawn without shell wrapper using cached CLI path. Faster. Falls back to `startPty` when CLI path isn't cached or `shellSetup` is configured.
3. **`startSshPty()`** — Wraps `ssh -tt {target}` for remote development.

**Session isolation**: For Claude, generates a deterministic UUID from task/conversation ID for `--session-id`/`--resume`. Session map persisted to `{userData}/pty-session-map.json`.

**PTY ID format** (`src/shared/ptyId.ts`): `{providerId}-main-{taskId}` or `{providerId}-chat-{conversationId}`.

**Environment**: PTYs use a minimal env (not `process.env`). The `AGENT_ENV_VARS` list in `ptyManager.ts` is the definitive passthrough list for API keys. Data is flushed over IPC every 16ms.

## Worktree System

**WorktreeService** (`src/main/services/WorktreeService.ts`):
- Creates worktrees at `../worktrees/{slugged-name}-{3-char-hash}` on branch `{prefix}/{slugged-name}-{hash}`
- Branch prefix defaults to `emdash`, configurable in settings
- Preserves gitignored files (`.env`, `.envrc`, etc.) from main repo to worktree
- Custom preserve patterns via `.emdash.json` at project root: `{ "preservePatterns": [".claude/**"] }`

**WorktreePoolService** (`src/main/services/WorktreePoolService.ts`):
Eliminates 3-7s worktree creation delay:
1. Pre-creates a `_reserve/{hash}` worktree in the background on project open
2. On task creation, instant `git worktree move` + `git branch -m` rename
3. Replenishes reserve in background after claiming
4. Reserves expire after 30 minutes; orphaned reserves cleaned on startup

## Multi-Chat Conversations

Tasks can have multiple conversation tabs, each with their own provider and PTY. Database `conversations` table tracks `isMain`, `provider`, `displayOrder`. For Claude, each conversation gets its own session UUID.

## Skills System

Implements the [Agent Skills](https://agentskills.io) standard — cross-agent reusable skill packages (`SKILL.md` with YAML frontmatter).

- **Central storage**: `~/.agentskills/{skill-name}/`, metadata in `~/.agentskills/.emdash/`
- **Agent sync**: Symlinks from central storage into each agent's native directory (`~/.claude/commands/`, `~/.codex/skills/`, etc.)
- **Aggregated catalog**: Merges from OpenAI repo, Anthropic repo, and local user-created skills
- **Key files**: `src/shared/skills/` (types, validation, agent targets), `src/main/services/SkillsService.ts` (core logic), `src/main/ipc/skillsIpc.ts`, `src/renderer/components/skills/`, `src/main/services/skills/bundled-catalog.json` (offline fallback)

## SSH Remote Development

Orchestrates agents on remote machines over SSH.

- **Connections**: Password, key, or agent auth. Credentials stored via `keytar` in OS keychain.
- **Remote worktrees**: Created at `<project>/.emdash/worktrees/<task-slug>/` on the server
- **Remote PTY**: Agent shells via `ssh2`'s shell API, streaming to UI in real-time
- **Key files**: `src/main/services/ssh/` (SshService, SshCredentialService, SshHostKeyService), `src/main/services/RemotePtyService.ts`, `src/main/services/RemoteGitService.ts`, `src/main/utils/shellEscape.ts`

**Local-only (not yet remote)**: file diffs, file watching, branch push, worktree pooling, GitHub/PR features.

**Security**: Shell args escaped via `quoteShellArg()` from `src/main/utils/shellEscape.ts`. Env var keys validated against `^[A-Za-z_][A-Za-z0-9_]*$`. Remote PTY restricted to allowlisted shell binaries. File access gated by `isPathSafe()`.

## Database & Migrations

- Schema in `src/main/db/schema.ts` → `pnpm exec drizzle-kit generate` to create migrations
- Browse: `pnpm exec drizzle-kit studio`
- Locations: macOS `~/Library/Application Support/emdash/emdash.db`, Linux `~/.config/emdash/emdash.db`, Windows `%APPDATA%\emdash\emdash.db`
- **NEVER** manually edit files in `drizzle/meta/` or numbered SQL migrations

## Code Style

- **TypeScript**: Strict mode enabled in both tsconfigs. Prefer explicit types over `any`. Type imports: `import type { Foo } from './bar'`
- **React**: Functional components with hooks. Both named and default exports are used.
- **File naming**: Components PascalCase (`FileExplorer.tsx`), hooks/utilities camelCase with `use` prefix (`useTaskManagement.ts`) or kebab-case (`use-toast.ts`). Tests: `*.test.ts`
- **Error handling**: Main → `log.error()` from `../lib/logger`, Renderer → `console.error()` or toast, IPC → `{ success: false, error }`
- **Styling**: Tailwind CSS classes

## Project Configuration

- **`.emdash.json`** at project root: `{ "preservePatterns": [".claude/**"] }` — controls which gitignored files are copied to worktrees. Also supports `shellSetup` for lifecycle scripts.
- **Branch prefix**: Configurable via app settings (`repository.branchPrefix`), defaults to `emdash`

## Environment Variables

All optional:
- `EMDASH_DB_FILE` — Override database file path
- `EMDASH_DISABLE_NATIVE_DB` — Disable native SQLite driver
- `EMDASH_DISABLE_CLONE_CACHE` — Disable clone caching
- `EMDASH_DISABLE_PTY` — Disable PTY support (used in tests)
- `TELEMETRY_ENABLED` — Toggle anonymous telemetry (PostHog)
- `CODEX_SANDBOX_MODE` / `CODEX_APPROVAL_POLICY` — Codex agent configuration

## Hot Reload

- **Renderer changes**: Hot-reload via Vite
- **Main process changes**: Require Electron restart (Ctrl+C → `pnpm run dev`)
- **Native modules**: Require `pnpm run rebuild`

## CI/CD

- **`code-consistency-check.yml`** (every PR): format check, type check, vitest
- **`release.yml`** (on `v*` tags): per-platform builds. Mac builds each arch separately to prevent native module architecture mismatches. Mac release includes signing + notarization.

## Common Pitfalls

1. **PTY resize after exit**: PTYs must be cleaned up on exit. Use `removePty()` in exit handlers.
2. **Worktree path resolution**: Always resolve paths from `WorktreeService`, not manually.
3. **IPC type safety**: Define all new IPC methods in `electron-api.d.ts`.
4. **Native module issues**: After updating node-pty/sqlite3/keytar, run `pnpm run rebuild`. Last resort: `pnpm run reset`.
5. **Monaco disposal**: Editor instances must be disposed to prevent memory leaks.
6. **CLI not found in agent**: If agents can't find `gh`, `codex`, etc., the PATH setup in `main.ts` may need updating for the platform.
7. **New provider integration**: Must add to registry in `src/shared/providers/registry.ts` AND add any API key to `AGENT_ENV_VARS` in `ptyManager.ts`.
8. **SSH shell injection**: All remote shell arguments must use `quoteShellArg()` from `src/main/utils/shellEscape.ts`.

## Risky Areas

- `src/main/db/**` + `drizzle/` — Schema migrations; mismatches can corrupt user data.
- `build/` entitlements and updater config — Incorrect changes break signing/auto-update.
- Native dependencies (`sqlite3`, `node-pty`, `keytar`) — Rebuilding is slow; avoid upgrading casually.
- PTY/terminal management — Race conditions or unhandled exits can kill agent runs.
- SSH services (`src/main/services/ssh/**`, `src/main/utils/shellEscape.ts`) — Security-critical: remote connections, credentials, shell command construction.

## Git Workflow

- Worktrees: `../worktrees/{workspace-name}-{hash}`, agents run there
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
- Example: `fix(agent): resolve worktree path issue (#123)`

## Key Configuration Files

- `vite.config.ts` — Renderer build + Vitest test config
- `drizzle.config.ts` — Database migration config (supports `EMDASH_DB_FILE` override)
- `tsconfig.json` — Renderer/shared TypeScript config (`module: ESNext`, `noEmit: true` — Vite does compilation)
- `tsconfig.main.json` — Main process TypeScript config (`module: CommonJS` — required by Electron main)
- `tailwind.config.js` — Tailwind configuration
- `.nvmrc` — Node version (22.20.0)
- Electron Builder config is in `package.json` under `"build"` key

## Pre-PR Checklist

- [ ] Dev server runs: `pnpm run d` (or `pnpm run dev`) starts cleanly.
- [ ] Code is formatted: `pnpm run format`.
- [ ] Lint passes: `pnpm run lint`.
- [ ] Types check: `pnpm run type-check`.
- [ ] Tests pass: `pnpm exec vitest run`.
- [ ] No stray build artifacts or secrets committed.
- [ ] Documented any schema or config changes impacting users.
