# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Emdash** is a cross-platform Electron application that orchestrates multiple CLI coding agents (Claude Code, Codex, Qwen Code, Amp, etc.) in parallel. Each agent runs in its own Git worktree to keep changes isolated, allowing simultaneous work on multiple features.

### Architecture

- **Main Process** (`src/main/`): Electron main process, IPC handlers, services
- **Renderer Process** (`src/renderer/`): React UI built with Vite
- **Shared** (`src/shared/`): Shared utilities and type definitions
- **Database**: SQLite via Drizzle ORM, stored in OS userData folder
- **Worktrees**: Created in sibling `worktrees/` directory (outside repo root)

### Tech Stack

- **Runtime**: Electron 30.5.1, Node.js 20.0.0+ (recommended: 22.20.0)
- **Frontend**: React 18, TypeScript 5.3, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, TypeScript, Drizzle ORM, SQLite3
- **Editor**: Monaco Editor 0.55 with syntax highlighting
- **Terminal**: xterm.js with canvas/webgl addons, node-pty 1.0
- **Native Modules**: node-pty, sqlite3, keytar (require rebuilding with `npm run rebuild`)
- **UI Components**: Radix UI primitives, lucide-react icons

## Development Commands

```bash
# Quick start (installs deps, rebuilds natives, starts dev)
npm run d

# Development (runs main + renderer concurrently)
npm run dev
npm run dev:main     # Electron main process only
npm run dev:renderer # Vite dev server only

# Building
npm run build        # Build both main and renderer
npm run build:main   # Build main process only
npm run build:renderer # Build renderer only

# Quality checks (run before committing)
npm run type-check   # TypeScript type checking
npm run lint         # ESLint
npm run format       # Format with Prettier
npm run format:check # Check formatting

# Testing
npx vitest run       # Run all tests
npx vitest run src/test/main/WorktreeService.test.ts  # Run specific test

# Native modules
npm run rebuild      # Rebuild native modules for current Electron version
npm run reset        # Clean install (removes node_modules, reinstalls)

# Packaging
npm run package      # Build and package for current platform
npm run package:mac  # Package for macOS (.dmg)
npm run package:linux # Package for Linux (.AppImage, .deb)
npm run package:win  # Package for Windows (.exe installer)

# Documentation
npm run docs         # Run docs dev server
npm run docs:build   # Build documentation
```

## Critical Rules

- **NEVER modify** `drizzle/meta/` or numbered migration files without coordination
- **NEVER commit** secrets, API keys, or user data
- **NEVER modify** `build/` entitlements or updater config without review
- **ALWAYS** run `npm run type-check` and `npm run lint` before committing
- **ALWAYS** test changes in both main and renderer processes
- **ALWAYS** use feature branches (never commit directly to `main`)
- **ALWAYS** put temporary notes, reference files, or scratch content in `.notes/` (gitignored)

## Code Organization

### Main Process (`src/main/`)

**Entry Points**:
- `entry.ts` - Bootstrap, path aliases setup, app name configuration
- `main.ts` - Process lifecycle, window management, IPC registration
- `preload.ts` - Exposes secure electronAPI to renderer

**Services** (`src/main/services/`):
- `WorktreeService.ts` (37KB) - Git worktree management, file preservation patterns
- `DatabaseService.ts` (28KB) - SQLite database operations
- `containerRunnerService.ts` (31KB) - Container orchestration for agents
- `GitHubService.ts` (30KB) - GitHub integration via CLI
- `PrGenerationService.ts` (22KB) - Automated PR generation
- `TerminalConfigParser.ts` (22KB) - Terminal configuration parsing
- `GitService.ts` (8KB) - Git operations
- `ptyManager.ts` (9KB) - PTY (terminal) management
- `TerminalSnapshotService.ts` - Terminal state persistence
- `ProjectRunConfigService.ts` - Project runtime configuration
- `LinearService.ts` - Linear issue tracking integration
- `JiraService.ts` - Jira issue tracking integration

**IPC Handlers** (`src/main/ipc/`):
- Each `*Ipc.ts` file handles specific IPC channels
- IPC handlers return `{ success: boolean, data?: any, error?: string }` format
- Types defined in `src/renderer/types/electron-api.d.ts` (500+ lines)

**Database** (`src/main/db/`):
- Schema defined in `schema.ts`
- Migrations in `drizzle/` directory (auto-generated via `drizzle-kit generate`)
- DB locations:
  - macOS: `~/Library/Application Support/emdash/emdash.db`
  - Linux: `~/.config/emdash/emdash.db`
  - Windows: `%APPDATA%\emdash\emdash.db`

### Renderer Process (`src/renderer/`)

**Main Components** (`src/renderer/components/`):
- `App.tsx` (79KB) - Root orchestration component
- `EditorMode.tsx` - Monaco code editor integration
- `ChatInterface.tsx` - Conversation UI
- `FileChangesPanel.tsx` - Diff visualization
- `ChangesDiffModal.tsx` - Change review modal
- `CommandPalette.tsx` - Command/action palette
- `FileExplorer/` - File tree navigation
- `BrowserPane.tsx` - Webview preview
- Use functional components with hooks
- Named exports preferred: `export function ComponentName() {}`
- Tailwind CSS for styling

**Hooks** (`src/renderer/hooks/`) - 31+ custom hooks:
- `useFileManager.ts` - File operations
- `useEditorDiffDecorations.ts` - Code highlighting
- `useLineComments.ts` - Inline comments
- `useKeyboardShortcuts.ts` - Keyboard handling
- `use-toast.ts` - Notifications
- Always call hooks at top level (no conditional hooks)

**UI Components** (`src/renderer/components/ui/`):
- Reusable UI primitives built with Radix UI
- Configured via `components.json`

### Shared Code (`src/shared/`)

- **Container module** - Orchestration config, port management, mock runner
- **Providers registry** - 20+ agent definitions with CLI commands, auth flags
- **LineComments utility** - Comment formatting helpers

### Test Structure (`src/test/`)

- **Main process tests**: `src/test/main/*.test.ts`
- **Renderer tests**: `src/test/renderer/*.test.ts`
- **Shared module tests**: `src/shared/**/*.test.ts`
- Uses Vitest for testing framework

### Path Aliases

```typescript
@/*         -> src/renderer/*
@shared/*   -> src/shared/*
#types/*    -> src/types/*
#types      -> src/types/index.ts
```

## Architecture Patterns

### IPC Communication Pattern

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

// Renderer (src/renderer/components/Example.tsx)
const result = await window.electronAPI.exampleAction({ id: '123' });
if (result.success) {
  // Handle success
} else {
  // Handle error: display toast or console.error
}
```

### Service Pattern

```typescript
// src/main/services/ExampleService.ts
export class ExampleService {
  private data = new Map<string, any>();

  async doSomething(id: string): Promise<any> {
    // Implementation
  }
}

export const exampleService = new ExampleService();
```

### React Hook Pattern

```typescript
// src/renderer/hooks/useExample.ts
export function useExample(id: string) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Fetch data via IPC, clean up listeners on unmount
    return () => {
      // Cleanup
    };
  }, [id]);

  return { data, loading };
}
```

## Code Style

### TypeScript

- Strict mode enabled (`strict: true`)
- Prefer explicit types over `any`; use `unknown` when type is truly unknown
- Type imports: `import type { Foo } from './bar'`
- Interfaces for object shapes, types for unions/intersections
- No `@ts-ignore` or `@ts-expect-error` without explanation

### React

- Functional components with hooks
- Clean up subscriptions/listeners in `useEffect` return
- Use `useMemo`/`useCallback` sparingly (only when needed)
- Event listeners must be cleaned up

### File Naming

- Components: PascalCase (`WorkspaceTerminalPanel.tsx`)
- Other files: kebab-case (`workspace-terminal-panel.tsx`)
- Test files: `*.test.ts` or `*.spec.ts`

### Error Handling

- Main process: Use `log.error()` from `../lib/logger`
- Renderer: Use `console.error()` or toast notifications
- IPC: Return `{ success: false, error: string }` format

## Database & Migrations

- **ORM**: Drizzle ORM with SQLite
- **Schema changes**: Modify `src/main/db/schema.ts`, then run `drizzle-kit generate`
- **Migration commands**:
  ```bash
  npx drizzle-kit generate  # Generate migration from schema changes
  npx drizzle-kit studio    # Open database browser
  ```
- **NEVER** manually edit migration files in `drizzle/meta/` or numbered SQL files
- **Coordinate** schema changes with team before committing migrations

## Git Workflow

### Worktree Pattern

- Worktrees created in sibling `../worktrees/` directory
- Each workspace gets its own worktree with unique branch
- Path format: `../worktrees/{workspace-name}-{timestamp}`
- Agents run in worktree directories, not base repo
- Use `git worktree prune` for cleanup, or in-app workspace removal
- File preservation: `.env` files and other patterns are preserved during worktree operations

### Commit Messages

Use conventional commits:
- `feat:` - new user-facing capability
- `fix:` - bug fix
- `refactor:` - code restructuring
- `docs:` - documentation changes
- `chore:` - maintenance tasks
- `test:` - test additions or changes

Example: `fix(agent): resolve worktree path issue (#123)`

## Hot Reload Behavior

- **Renderer changes**: Hot-reload automatically via Vite
- **Main process changes**: Require Electron app restart (Ctrl+C and re-run `npm run dev`)
- **Native modules**: Require `npm run rebuild`

## Common Pitfalls

1. **PTY Resize Errors**: PTYs must be cleaned up on exit. Use `removePty()` in exit handlers.
2. **Worktree Path Resolution**: Always resolve worktree paths from `WorktreeService` when working with agents.
3. **React Hooks Rules**: Never call hooks conditionally or after early returns.
4. **IPC Type Safety**: Always define types in `electron-api.d.ts` for IPC methods.
5. **Native Module Issues**: After updating node-pty, sqlite3, or keytar, run `npm run rebuild`. If problems persist, use `npm run reset`.
6. **Database Migrations**: Never manually edit migration files; always use Drizzle Kit.
7. **Monaco Editor**: Editor instances must be properly disposed to avoid memory leaks.
8. **File Watchers**: Clean up file system watchers to prevent resource exhaustion.

## Key Integration Points

### Supported Coding Agents

Emdash supports 15+ CLI providers including:
- Claude Code (`npm install -g @anthropic-ai/claude-code`)
- Codex (`npm install -g @openai/codex`)
- Amp (`npm install -g @sourcegraph/amp@latest`)
- Qwen Code (`npm install -g @qwen-code/qwen-code`)
- Cursor (`curl https://cursor.com/install -fsS | bash`)
- Gemini (`npm install -g @google/gemini-cli`)
- GitHub Copilot (`npm install -g @github/copilot`)
- And more...

See README.md and AGENTS.md for full list and install commands.

### Issue Tracking

- **Linear**: Connect with API key
- **Jira**: Provide site URL, email, and API token
- **GitHub Issues**: Authenticate via `gh auth login`

### GitHub CLI

Required for GitHub features (PRs, repo info, GitHub Issues). Install and authenticate:
```bash
brew install gh  # or npm install -g @github/gh
gh auth login
```

## Development Environment Setup

### Prerequisites

```bash
# Node.js (use nvm)
nvm use  # Installs Node 22.20.0 from .nvmrc

# Optional but recommended
brew install gh  # GitHub CLI
npm install -g @anthropic-ai/claude-code  # For Claude Code testing
npm install -g @openai/codex  # For Codex testing
```

### First Time Setup

```bash
git clone <repo-url>
cd emdash
nvm use
npm run d  # Installs deps, rebuilds natives, starts dev
```

## Debugging

- **Main process logs**: Terminal where `npm run dev:main` runs
- **Renderer logs**: Browser DevTools (View → Toggle Developer Tools)
- **IPC debugging**: Add `log.debug()` calls in IPC handlers
- **Database**: Location logged on startup, use `npx drizzle-kit studio` for browser
- **Worktrees**: Check `../worktrees/` directory
- **PTY issues**: Check for `ptyManager:resizeAfterExit` warnings
- **Memory leaks**: Use Chrome DevTools Memory Profiler
- **Performance**: Use React DevTools Profiler

## Security & Privacy

- **Never commit**: API keys, tokens, credentials, or user data
- **Database**: Stored locally in OS userData folder
- **Logs**: Agent logs stored in userData/logs/ (outside repos)
- **Telemetry**: Anonymous usage events only (PostHog); can be disabled in Settings
- **IPC**: Validate all inputs, sanitize user-provided data
- **Preload**: Minimal API surface exposed via contextBridge

## Release Process

```bash
# Bump version (auto-updates package.json, creates tag)
npm version patch   # 0.2.9 → 0.2.10 (bug fixes)
npm version minor   # 0.2.9 → 0.3.0 (new features)
npm version major   # 0.2.9 → 1.0.0 (breaking changes)

# Push to trigger CI/CD
git push && git push --tags
```

GitHub Actions automatically builds, signs, notarizes, and creates release with artifacts for all platforms.

## Key Configuration Files

- `vite.config.ts` - Renderer build configuration
- `drizzle.config.ts` - Database migration configuration
- `electron-builder.yml` - Electron packaging configuration (in package.json)
- `tsconfig.json`, `tsconfig.main.json` - TypeScript configurations
- `tailwind.config.js` - Tailwind CSS configuration
- `.nvmrc` - Node version specification (22.20.0)