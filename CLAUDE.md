# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Emdash** is a cross-platform Electron application that orchestrates multiple CLI coding agents (Claude Code, Codex, Qwen Code, Amp, etc.) in parallel. Each agent runs in its own Git worktree to keep changes isolated, allowing simultaneous work on multiple features.

### Architecture

- **Main Process** (`src/main/`): Electron main process — IPC handlers, services, database, PTY management
- **Renderer Process** (`src/renderer/`): React UI built with Vite — components, hooks, terminal panes
- **Shared** (`src/shared/`): Provider registry (20+ agent definitions), shared utilities
- **Database**: SQLite via Drizzle ORM, stored in OS userData folder
- **Worktrees**: Created in sibling `../worktrees/` directory (outside repo root)

### Tech Stack

- **Runtime**: Electron 30.5.1, Node.js 20.0.0+ (recommended: 22.20.0 via `.nvmrc`)
- **Frontend**: React 18, TypeScript 5.3, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, TypeScript, Drizzle ORM, SQLite3
- **Editor**: Monaco Editor 0.55, **Terminal**: xterm.js + node-pty 1.0
- **Native Modules**: node-pty, sqlite3, keytar (require `npm run rebuild` after updates)
- **UI**: Radix UI primitives, lucide-react icons

## Development Commands

```bash
# Quick start (installs deps, rebuilds natives, starts dev)
npm run d

# Development (runs main + renderer concurrently)
npm run dev
npm run dev:main     # Electron main process only (tsc + electron)
npm run dev:renderer # Vite dev server only (port 3000)

# Quality checks (run before committing)
npm run type-check   # TypeScript type checking (uses tsconfig.json — renderer/shared/types)
npm run lint         # ESLint
npm run format       # Format with Prettier

# Testing
npx vitest run                                         # Run all tests
npx vitest run src/test/main/WorktreeService.test.ts   # Run specific test

# Native modules
npm run rebuild      # Rebuild native modules for Electron
npm run reset        # Clean install (removes node_modules, reinstalls)

# Building & Packaging
npm run build        # Build main + renderer
npm run package:mac  # macOS .dmg (arm64)
npm run package:linux # Linux AppImage/deb (x64)
npm run package:win  # Windows nsis/portable (x64)
```

## Critical Rules

- **NEVER modify** `drizzle/meta/` or numbered migration files — always use `drizzle-kit generate`
- **NEVER modify** `build/` entitlements or updater config without review
- **ALWAYS** run `npm run type-check` and `npm run lint` before committing
- **ALWAYS** use feature branches (never commit directly to `main`)
- Put temporary notes or scratch content in `.notes/` (gitignored)

## Code Organization

### Main Process (`src/main/`)

**Boot sequence**: `entry.ts` → `main.ts` → IPC registration → window creation

- `entry.ts` — Sets app name (must happen before `app.getPath('userData')` is called, or Electron defaults to `~/Library/Application Support/Electron`). Monkey-patches `Module._resolveFilename` to resolve `@shared/*` and `@/*` path aliases at runtime in compiled JS.
- `main.ts` — Loads `.env`, fixes PATH for CLI discovery on macOS/Linux/Windows (adds Homebrew, npm global, nvm paths so agents like `gh`, `codex`, `claude` are found when launched from Finder), then initializes Electron windows and registers all IPC handlers.
- `preload.ts` — Exposes secure `electronAPI` to renderer via `contextBridge`.

**Services** (`src/main/services/`):
- `WorktreeService.ts` — Git worktree lifecycle, file preservation patterns
- `WorktreePoolService.ts` — Worktree pooling/reuse layer
- `DatabaseService.ts` — All SQLite CRUD operations
- `GitHubService.ts` — GitHub integration via `gh` CLI
- `GitService.ts` — Git operations
- `PrGenerationService.ts` — Automated PR generation
- `TerminalConfigParser.ts` — Terminal configuration parsing
- `ptyManager.ts` — PTY (pseudo-terminal) lifecycle management
- `TerminalSnapshotService.ts` — Terminal state persistence
- `AutoUpdateService.ts` — Electron auto-update management
- `ConnectionsService.ts` — External service connections
- `ProjectSettingsService.ts` — Project-level settings
- `LifecycleScriptsService.ts` — Lifecycle script execution
- `LinearService.ts` / `JiraService.ts` — Issue tracker integrations
- `ProjectPrep.ts` — Project preparation logic
- `RepositoryManager.ts` — Repository management

Note: Some IPC handler files are colocated in `services/` (e.g., `worktreeIpc.ts`, `ptyIpc.ts`, `updateIpc.ts`, `lifecycleIpc.ts`, `planLockIpc.ts`, `fsIpc.ts`).

**IPC Handlers** (`src/main/ipc/`):
- 17 handler files: `appIpc`, `dbIpc`, `gitIpc`, `githubIpc`, `browserIpc`, `connectionsIpc`, `projectIpc`, `projectSettingsIpc`, `settingsIpc`, `telemetryIpc`, `lineCommentsIpc`, `linearIpc`, `jiraIpc`, `hostPreviewIpc`, `netIpc`, `debugIpc`, plus `index.ts`
- All return `{ success: boolean, data?: any, error?: string }` format
- Types defined in `src/renderer/types/electron-api.d.ts`

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

**Other renderer directories**:
- `hooks/` — Custom React hooks (file operations, keyboard shortcuts, editor decorations, etc.)
- `contexts/` — React context providers
- `lib/` — Utility functions
- `providers/` — Provider-specific components
- `terminal/` — Terminal emulation components
- `types/` — TypeScript type definitions (incl. `electron-api.d.ts`)
- `ui/` — Reusable UI primitives (Radix-based, configured via `components.json`)

### Path Aliases

**Important**: `@/*` resolves differently in main vs renderer:

| Alias | tsconfig.json (renderer) | tsconfig.main.json (main) |
|-------|-------------------------|--------------------------|
| `@/*` | `src/renderer/*` | `src/*` |
| `@shared/*` | `src/shared/*` | `src/shared/*` |
| `#types/*` | `src/types/*` | _(not available)_ |
| `#types` | `src/types/index.ts` | _(not available)_ |

At runtime in compiled main process, `entry.ts` monkey-patches `Module._resolveFilename` to map `@shared/*` → `dist/main/shared/*` and `@/*` → `dist/main/main/*`.

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

### Services

Services are singleton classes with a module-level export:
```typescript
export class ExampleService { /* ... */ }
export const exampleService = new ExampleService();
```

## Code Style

- **TypeScript**: Strict mode. Prefer explicit types over `any`. Type imports: `import type { Foo } from './bar'`
- **React**: Functional components with hooks. Named exports preferred. Clean up subscriptions in `useEffect` return.
- **File naming**: Components PascalCase (`FileExplorer.tsx`), other files kebab-case (`use-toast.ts`). Tests: `*.test.ts`
- **Error handling**: Main → `log.error()` from `../lib/logger`, Renderer → `console.error()` or toast, IPC → `{ success: false, error }`
- **Styling**: Tailwind CSS classes

## Database & Migrations

- Modify schema in `src/main/db/schema.ts`, then `npx drizzle-kit generate`
- Browse DB: `npx drizzle-kit studio`
- **NEVER** manually edit files in `drizzle/meta/` or numbered SQL migrations

## Environment Variables

All optional:
- `EMDASH_DB_FILE` — Override database file path
- `EMDASH_DISABLE_NATIVE_DB` — Disable native SQLite driver
- `EMDASH_DISABLE_CLONE_CACHE` — Disable clone caching
- `EMDASH_DISABLE_PTY` — Disable PTY support
- `TELEMETRY_ENABLED` — Toggle anonymous telemetry (PostHog)
- `CODEX_SANDBOX_MODE` / `CODEX_APPROVAL_POLICY` — Codex agent configuration

## Hot Reload

- **Renderer changes**: Hot-reload via Vite
- **Main process changes**: Require Electron restart (Ctrl+C → `npm run dev`)
- **Native modules**: Require `npm run rebuild`

## Common Pitfalls

1. **PTY resize after exit**: PTYs must be cleaned up on exit. Use `removePty()` in exit handlers.
2. **Worktree path resolution**: Always resolve paths from `WorktreeService`, not manually.
3. **IPC type safety**: Define all new IPC methods in `electron-api.d.ts`.
4. **Native module issues**: After updating node-pty/sqlite3/keytar, run `npm run rebuild`. Last resort: `npm run reset`.
5. **Monaco disposal**: Editor instances must be disposed to prevent memory leaks.
6. **CLI not found in agent**: If agents can't find `gh`, `codex`, etc., the PATH setup in `main.ts` may need updating for the platform.

## Risky Areas

- `src/main/db/**` + `drizzle/` — Schema migrations; mismatches can corrupt user data
- `build/` entitlements and updater config — Incorrect changes break signing/auto-update
- Native dependencies (`sqlite3`, `node-pty`, `keytar`) — Rebuilding is slow; avoid upgrading casually
- PTY/terminal management — Race conditions or unhandled exits can kill agent runs

## Pre-PR Checklist

- [ ] Dev server runs: `npm run d` starts cleanly
- [ ] Checks pass: `npm run lint`, `npm run type-check`, `npx vitest run`
- [ ] No stray build artifacts or secrets committed
- [ ] Schema or config changes documented

## Git Workflow

- Worktrees: `../worktrees/{workspace-name}-{timestamp}`, agents run there
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`
- Example: `fix(agent): resolve worktree path issue (#123)`

## Key Configuration Files

- `vite.config.ts` — Renderer build + Vitest test config
- `drizzle.config.ts` — Database migration config (supports `EMDASH_DB_FILE` override)
- `tsconfig.json` — Renderer/shared TypeScript config
- `tsconfig.main.json` — Main process TypeScript config (CommonJS output)
- `tailwind.config.js` — Tailwind configuration
- `.nvmrc` — Node version (22.20.0)
- Electron Builder config is in `package.json` under `"build"` key
