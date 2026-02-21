---
default_branch: main
package_manager: pnpm
node_version: "22.20.0"
start_command: "pnpm run d"
dev_command: "pnpm run dev"
build_command: "pnpm run build"
test_commands:
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

## Quickstart

1. `nvm use` (installs Node 22.20.0 if missing) or install Node 22.x manually.
2. `pnpm run d` to install dependencies and launch Electron + Vite.
3. If `pnpm run d` fails mid-stream, rerun `pnpm install`, then `pnpm run dev` (main + renderer).

## Testing

1. `pnpm run lint` — ESLint
2. `pnpm run type-check` — TypeScript (uses `tsconfig.json` for renderer/shared/types)
3. `pnpm exec vitest run` — Vitest (tests under `src/**/*.test.ts`)
4. `pnpm exec vitest run src/test/main/WorktreeService.test.ts` — run a single test

Tests use `vi.mock()` to stub `electron`, `DatabaseService`, `logger`, etc. Integration tests create real git repos in `os.tmpdir()`. No shared test setup file — mocks are per-file.

## Build & Package

1. `pnpm run build` to compile the Electron main and Vite renderer.
2. Platform-specific installers: `pnpm run package:mac|linux|win` (artifacts in `release/`).
3. If native modules misbehave, `pnpm run rebuild`; use `pnpm run reset` as a last resort.

## Architecture

### Process Model

- **Main process** (`src/main/`): Electron main — IPC handlers, services, database, PTY management
- **Renderer process** (`src/renderer/`): React UI built with Vite — components, hooks, terminal panes
- **Shared** (`src/shared/`): Provider registry (21 agent definitions), PTY ID helpers, shared utilities

### Boot Sequence

`entry.ts` → `main.ts` → IPC registration → window creation

- `entry.ts` — Sets app name (must happen before `app.getPath('userData')`). Monkey-patches `Module._resolveFilename` to resolve `@shared/*` and `@/*` path aliases at runtime.
- `main.ts` — Loads `.env`, fixes PATH for CLI discovery per platform (Homebrew, nvm, npm-global), detects `SSH_AUTH_SOCK` from login shell, initializes windows and IPC.

### Path Aliases

`@/*` resolves differently in main vs renderer:

| Alias | tsconfig.json (renderer) | tsconfig.main.json (main) |
|-------|-------------------------|--------------------------|
| `@/*` | `src/renderer/*` | `src/*` |
| `@shared/*` | `src/shared/*` | `src/shared/*` |

Main uses `module: "CommonJS"` (required by Electron), renderer uses `module: "ESNext"` (Vite handles compilation).

### Key Directories

- `src/main/services/` — Core services (worktrees, PTY, database, git, SSH, skills)
- `src/main/ipc/` — 17+ IPC handler files; all return `{ success: boolean, data?, error? }`
- `src/main/db/` — SQLite schema (`schema.ts`) + Drizzle ORM migrations (`drizzle/`)
- `src/renderer/components/` — React components (App.tsx is ~79KB root orchestrator)
- `src/renderer/hooks/` — 38+ hooks; `useTaskManagement` (~870 lines) handles full task lifecycle
- `src/renderer/types/electron-api.d.ts` — Canonical IPC type definitions (~1800 lines)
- `src/shared/providers/registry.ts` — All CLI agent definitions

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

## CI/CD

- **`code-consistency-check.yml`** (every PR): format check, type check, vitest
- **`release.yml`** (on `v*` tags): per-platform builds. Mac builds each arch separately to prevent native module architecture mismatches. Mac release includes signing + notarization.

## Guardrails

- Do work on branches or worktrees; default branch is `main`, never push directly.
- Do limit edits to `src/**`, `docs/**`, or config files you fully understand; keep `dist/`, `release/`, and `build/` untouched.
- Don't rewrite Drizzle migration history (`drizzle/meta`, numbered SQL).
- Don't modify telemetry defaults or updater logic unless intentional and reviewed.
- Don't run commands that mutate global environments (global package installs, git pushes) from agent scripts.

## Risky Areas

- `src/main/db/**` + `drizzle/` — Schema migrations; mismatches can corrupt user data.
- `build/` entitlements and updater config — Incorrect changes break signing/auto-update.
- Native dependencies (`sqlite3`, `node-pty`, `keytar`) — Rebuilding is slow; avoid upgrading casually.
- PTY/terminal management — Race conditions or unhandled exits can kill agent runs.
- SSH services (`src/main/services/ssh/**`, `src/main/utils/shellEscape.ts`) — Security-critical: remote connections, credentials, shell command construction.

## Pre-PR Checklist

- [ ] Dev server runs: `pnpm run d` (or `pnpm run dev`) starts cleanly.
- [ ] Tests and checks pass: `pnpm run lint`, `pnpm run type-check`, `pnpm exec vitest run`.
- [ ] No stray build artifacts or secrets committed.
- [ ] Documented any schema or config changes impacting users.
