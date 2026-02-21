# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Emdash** is a cross-platform Electron application that orchestrates multiple CLI coding agents (Claude Code, Codex, Qwen Code, Amp, etc.) in parallel. Each agent runs in its own Git worktree to keep changes isolated, allowing simultaneous work on multiple features. It also supports remote development over SSH.

### Architecture

- **Main Process** (`src/main/`): Electron main process — IPC handlers, services, database, PTY management
- **Renderer Process** (`src/renderer/`): React UI built with Vite — components, hooks, terminal panes
- **Shared** (`src/shared/`): Provider registry (21 agent definitions), PTY ID helpers, shared utilities
- **Database**: SQLite via Drizzle ORM, stored in OS userData folder
- **Worktrees**: Created in sibling `../worktrees/` directory (outside repo root)

### Tech Stack

- **Runtime**: Electron 30.5.1, Node.js 20.0.0+ (recommended: 22.20.0 via `.nvmrc`)
- **Frontend**: React 18, TypeScript 5.3, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, TypeScript, Drizzle ORM, SQLite3
- **Editor**: Monaco Editor 0.55, **Terminal**: xterm.js + node-pty 1.0
- **Native Modules**: node-pty, sqlite3, keytar (require `pnpm run rebuild` after updates)
- **UI**: Radix UI primitives, lucide-react icons

## Development Commands

```bash
# Quick start (installs deps, starts dev)
pnpm run d

# Development (runs main + renderer concurrently)
pnpm run dev
pnpm run dev:main     # Electron main process only (tsc + electron)
pnpm run dev:renderer # Vite dev server only (port 3000)

# Quality checks (run before committing)
pnpm run type-check   # TypeScript type checking (uses tsconfig.json — renderer/shared/types)
pnpm run lint         # ESLint
pnpm run format       # Format with Prettier

# Testing
pnpm exec vitest run                                         # Run all tests
pnpm exec vitest run src/test/main/WorktreeService.test.ts   # Run specific test

# Native modules
pnpm run rebuild      # Rebuild native modules for Electron
pnpm run reset        # Clean install (removes node_modules, reinstalls)

# Building & Packaging
pnpm run build        # Build main + renderer
pnpm run package:mac  # macOS .dmg (arm64)
pnpm run package:linux # Linux AppImage/deb (x64)
pnpm run package:win  # Windows nsis/portable (x64)
```

## Critical Rules

- **NEVER modify** `drizzle/meta/` or numbered migration files — always use `drizzle-kit generate`
- **NEVER modify** `build/` entitlements or updater config without review
- **ALWAYS** run `pnpm run type-check` and `pnpm run lint` before committing
- **ALWAYS** use feature branches (never commit directly to `main`)
- Put temporary notes or scratch content in `.notes/` (gitignored)

## Code Organization

### Main Process (`src/main/`)

**Boot sequence**: `entry.ts` → `main.ts` → IPC registration → window creation

- `entry.ts` — Sets app name (must happen before `app.getPath('userData')` is called, or Electron defaults to `~/Library/Application Support/Electron`). Monkey-patches `Module._resolveFilename` to resolve `@shared/*` and `@/*` path aliases at runtime in compiled JS.
- `main.ts` — Loads `.env`, fixes PATH for CLI discovery on macOS/Linux/Windows (adds Homebrew, npm global, nvm paths so agents like `gh`, `codex`, `claude` are found when launched from Finder), detects `SSH_AUTH_SOCK` from user's login shell, then initializes Electron windows and registers all IPC handlers.
- `preload.ts` — Exposes secure `electronAPI` to renderer via `contextBridge`.

**Key services** (`src/main/services/`):
- `WorktreeService.ts` — Git worktree lifecycle, file preservation patterns
- `WorktreePoolService.ts` — Worktree pooling/reuse for instant task starts
- `DatabaseService.ts` — All SQLite CRUD operations
- `ptyManager.ts` — PTY (pseudo-terminal) lifecycle, session isolation, agent spawning
- `SkillsService.ts` — Cross-agent skill installation and catalog management
- `GitHubService.ts` / `GitService.ts` — Git and GitHub operations via `gh` CLI
- `PrGenerationService.ts` — Automated PR generation
- `ssh/` — SSH connection management, credentials (via keytar), host key verification

Note: Some IPC handler files are colocated in `services/` (e.g., `worktreeIpc.ts`, `ptyIpc.ts`, `updateIpc.ts`, `lifecycleIpc.ts`, `planLockIpc.ts`, `fsIpc.ts`).

**IPC Handlers** (`src/main/ipc/`):
- 17+ handler files covering app, db, git, github, browser, connections, project, settings, telemetry, SSH, Linear, Jira, skills, and more
- All return `{ success: boolean, data?: any, error?: string }` format
- Types defined in `src/renderer/types/electron-api.d.ts` (~1800 lines)

**Database** (`src/main/db/`):
- Schema: `schema.ts` — Migrations: `drizzle/` (auto-generated)
- Locations: macOS `~/Library/Application Support/emdash/emdash.db`, Linux `~/.config/emdash/emdash.db`, Windows `%APPDATA%\emdash\emdash.db`
- Override with `EMDASH_DB_FILE` env var

### Renderer Process (`src/renderer/`)

**Key components** (`components/`):
- `App.tsx` — Root orchestration (very large, ~79KB)
- `EditorMode.tsx` — Monaco code editor
- `ChatInterface.tsx` — Conversation UI
- `FileChangesPanel.tsx` / `ChangesDiffModal.tsx` — Diff visualization and review
- `CommandPalette.tsx` — Command/action palette
- `FileExplorer/` — File tree navigation
- `BrowserPane.tsx` — Webview preview
- `skills/` — Skills catalog and management UI
- `ssh/` — SSH connection UI components

**Key hooks** (`hooks/`):
- `useAppInitialization` — Two-round project/task loading (fast skeleton then full), restores last active project/task from localStorage
- `useTaskManagement` — Full task lifecycle (~870 lines): create, delete, rename, archive, restore. Handles optimistic UI removal with rollback, lifecycle teardown, PTY cleanup
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

## Key Architecture Concepts

### Provider Registry (`src/shared/providers/registry.ts`)

All 21 CLI agents are defined as `ProviderDefinition` objects in a central registry. Key fields:

- `cli` — binary name, `commands` — detection commands (may differ from cli)
- `autoApproveFlag` — e.g. `--dangerously-skip-permissions` for Claude
- `initialPromptFlag` — how to pass the initial prompt (e.g. `-i` for Gemini, `''` means positional arg)
- `useKeystrokeInjection` — `true` for agents with no CLI prompt flag (Amp, OpenCode); Emdash types the prompt into the TUI after startup
- `sessionIdFlag` — only Claude; enables multi-chat session isolation via `--session-id`
- `resumeFlag` — e.g. `-c -r` for Claude, `--continue` for Kilocode

Adding a new provider means adding a definition here and its API key to the `AGENT_ENV_VARS` list in `ptyManager.ts`.

### PTY Management (`src/main/services/ptyManager.ts`, `ptyIpc.ts`)

Three spawn modes:
1. **`startPty()`** — Shell-based: spawns `{cli} {args}; exec {shell} -il` so the user gets a shell after the agent exits
2. **`startDirectPty()`** — Direct spawn without shell wrapper using cached CLI path. Faster. Falls back to `startPty` when CLI path isn't cached or `shellSetup` is configured
3. **`startSshPty()`** — Wraps `ssh -tt {target}` for remote development

**Session isolation** (`applySessionIsolation`): For Claude, generates a deterministic UUID from task/conversation ID. Enables `--resume` for existing sessions and `--session-id` for new multi-chat tabs. Session map persisted to `{userData}/pty-session-map.json`.

**PTY ID format** (defined in `src/shared/ptyId.ts`): `{providerId}-main-{taskId}` or `{providerId}-chat-{conversationId}`.

**Environment passthrough**: PTYs use a minimal env (not `process.env` wholesale). The `AGENT_ENV_VARS` list in `ptyManager.ts` is the definitive list of API keys passed to agent processes (covers `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, AWS vars, `GH_TOKEN`, etc.). Data is flushed over IPC every 16ms to reduce overhead.

### Worktree System

**WorktreeService** (`src/main/services/WorktreeService.ts`):
- Creates worktrees at `../worktrees/{slugged-name}-{3-char-hash}` on branch `{prefix}/{slugged-name}-{hash}`
- Branch prefix defaults to `emdash`, configurable in settings (`repository.branchPrefix`)
- Preserves gitignored files (`.env`, `.envrc`, `docker-compose.override.yml`) from main repo to worktree
- Custom preserve patterns via `.emdash.json` at project root: `{ "preservePatterns": [".claude/**"] }`

**WorktreePoolService** (`src/main/services/WorktreePoolService.ts`):
Eliminates the 3-7 second worktree creation delay:
1. On project open, pre-creates a `_reserve/{hash}` worktree in the background
2. On task creation, `claimReserve()` uses instant `git worktree move` + `git branch -m` rename
3. After claiming, replenishes the reserve in the background
4. Reserves expire after 30 minutes; orphaned reserves cleaned up on app startup

### Multi-Chat Conversations

Tasks can have multiple conversation tabs, each with their own provider. Database `conversations` table has `isMain`, `provider`, `displayOrder` fields. Each conversation gets its own PTY and (for Claude) session UUID via `sessionIdFlag`.

### Skills System

Implements the open [Agent Skills](https://agentskills.io) standard for cross-agent reusable skill packages.

- **Central storage**: `~/.agentskills/{skill-name}/`, metadata in `~/.agentskills/.emdash/`
- **Agent sync**: Symlinks from central storage into each agent's native directory (`~/.claude/commands/`, `~/.codex/skills/`, etc.)
- **Aggregated catalog**: Merges skills from OpenAI repo, Anthropic repo, and local user-created skills
- **Key files**: `src/shared/skills/` (types, validation, agent targets), `src/main/services/SkillsService.ts` (core logic), `src/main/ipc/skillsIpc.ts`, `src/renderer/components/skills/` (UI), `src/main/services/skills/bundled-catalog.json` (offline fallback)

### SSH Remote Development

Orchestrates agents on remote machines over SSH (useful for compliance, large repos, GPU requirements).

- **Connections**: Password, key, or agent auth. Credentials stored via `keytar` in OS keychain.
- **Remote worktrees**: Created at `<project>/.emdash/worktrees/<task-slug>/` on the server
- **Remote PTY**: Agent shells launched over SSH via `ssh2`'s shell API, streaming output in real-time
- **Security**: Shell args escaped via `quoteShellArg()` (`src/main/utils/shellEscape.ts`), env var keys validated, remote PTY restricted to allowlisted shell binaries, file access gated by `isPathSafe()`
- **Key files**: `src/main/services/ssh/` (SshService, SshCredentialService, SshHostKeyService), `src/main/services/RemotePtyService.ts`, `src/main/services/RemoteGitService.ts`
- **Local-only features** (not yet remote): file diffs, file watching, branch push, worktree pooling, GitHub/PR features

## Architecture Patterns

### IPC Communication

```typescript
// Main process (src/main/ipc/exampleIpc.ts)
ipcMain.handle('example:action', async (_event, args: { id: string }) => {
  try {
    const result = await service.doSomething(args.id);
    return { success: true, data: result };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// Renderer — call via window.electronAPI
const result = await window.electronAPI.exampleAction({ id: '123' });
```

All new IPC methods must be declared in `src/renderer/types/electron-api.d.ts`.

### Services

Services are singleton classes with a module-level export:
```typescript
export class ExampleService { /* ... */ }
export const exampleService = new ExampleService();
```

## Testing

- **Framework**: Vitest (configured in `vite.config.ts`, `environment: 'node'`)
- **Test locations**: `src/test/main/` (8 service tests), `src/test/renderer/` (3 UI tests), `src/main/utils/__tests__/` (utility tests)
- **Mocking pattern**: `vi.mock()` to stub `electron`, `DatabaseService`, `ProjectSettingsService`, `logger`, `settings`. No shared test setup file — mocks are per-file.
- **Integration tests**: Create real git repos in `os.tmpdir()` using `execSync('git init')` for worktree/git tests

## CI/CD (`.github/workflows/`)

- **`code-consistency-check.yml`** (runs on every PR): format check, type check, vitest. Lint check is currently disabled (TODO).
- **`release.yml`** (on `v*` tags): Builds per-platform. Mac builds each arch separately (not `--x64 --arm64` together) to prevent native module architecture mismatches. Mac release includes signing + notarization.

## Code Style

- **TypeScript**: Strict mode. Prefer explicit types over `any`. Type imports: `import type { Foo } from './bar'`
- **React**: Functional components with hooks. Named exports preferred. Clean up subscriptions in `useEffect` return.
- **File naming**: Components PascalCase (`FileExplorer.tsx`), other files kebab-case (`use-toast.ts`). Tests: `*.test.ts`
- **Error handling**: Main → `log.error()` from `../lib/logger`, Renderer → `console.error()` or toast, IPC → `{ success: false, error }`
- **Styling**: Tailwind CSS classes

## Database & Migrations

- Modify schema in `src/main/db/schema.ts`, then `pnpm exec drizzle-kit generate`
- Browse DB: `pnpm exec drizzle-kit studio`
- **NEVER** manually edit files in `drizzle/meta/` or numbered SQL migrations

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

- `src/main/db/**` + `drizzle/` — Schema migrations; mismatches can corrupt user data
- `build/` entitlements and updater config — Incorrect changes break signing/auto-update
- Native dependencies (`sqlite3`, `node-pty`, `keytar`) — Rebuilding is slow; avoid upgrading casually
- PTY/terminal management — Race conditions or unhandled exits can kill agent runs
- SSH services (`src/main/services/ssh/**`, `src/main/utils/shellEscape.ts`) — Security-critical: remote connections, credentials, shell command construction

## Pre-PR Checklist

- [ ] Dev server runs: `pnpm run d` starts cleanly
- [ ] Checks pass: `pnpm run lint`, `pnpm run type-check`, `pnpm exec vitest run`
- [ ] No stray build artifacts or secrets committed
- [ ] Schema or config changes documented

## Git Workflow

- Worktrees: `../worktrees/{workspace-name}-{timestamp}`, agents run there
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
