# Emdash Development Guide

This file provides context and best practices for working with the Emdash codebase using Claude Code.

## 🚨 CRITICAL RULES

- **NEVER modify** `drizzle/meta/` or numbered migration files without explicit coordination
- **NEVER commit** secrets, API keys, or user data
- **NEVER modify** `build/` entitlements or updater config without review
- **ALWAYS** run `npm run type-check` and `npm run lint` before committing
- **ALWAYS** test changes in both main and renderer processes
- **ALWAYS** use worktrees for feature development (never commit directly to `main`) !!!!!

## 📋 Project Context

**Emdash** is a cross-platform Electron application that orchestrates multiple coding agents (Claude Code, Codex, etc.) in parallel. Each agent runs in its own Git worktree to keep changes isolated.

### Architecture

- **Main Process** (`src/main/`): Electron main process, IPC handlers, services (Git, worktrees, agents, database)
- **Renderer Process** (`src/renderer/`): React UI built with Vite, hooks, components
- **Shared** (`src/shared/`): Shared utilities and type definitions
- **Database**: SQLite via Drizzle ORM, stored in OS userData folder
- **Worktrees**: Created in sibling `worktrees/` directory (outside repo root)

### Tech Stack

- **Runtime**: Electron 30.5.1, Node.js 20.0.0+ (recommended: 22.20.0)
- **Frontend**: React 18, TypeScript 5.3, Vite 5, Tailwind CSS 3
- **Backend**: Node.js, TypeScript, Drizzle ORM, SQLite3
- **Native Modules**: node-pty, sqlite3, keytar (require rebuilding)

## 🔧 Bash Commands

### Development

```bash
# Quick start: install dependencies and run dev server
npm run d

# Or separately:
npm install          # Install dependencies
npm run dev          # Run main + renderer concurrently
npm run dev:main     # Run Electron main process only
npm run dev:renderer # Run Vite dev server only
```

### Building & Testing

```bash
npm run build        # Build both main and renderer
npm run build:main   # Build main process only
npm run build:renderer # Build renderer only

npm run type-check   # TypeScript type checking
npm run lint         # ESLint
npm run format       # Format with Prettier
npm run format:check # Check formatting

npx vitest run       # Run tests (tests in src/**/*.test.ts)
```

### Native Modules

```bash
npm run rebuild      # Rebuild native modules (sqlite3, node-pty, keytar)
npm run reset        # Clean install (removes node_modules, reinstalls)
```

### Packaging

```bash
npm run package      # Build and package for current platform
npm run package:mac  # Package for macOS
npm run package:linux # Package for Linux
npm run package:win  # Package for Windows
```

## 📐 Code Style Guidelines

### TypeScript

- Use **strict TypeScript** (`strict: true` in tsconfig)
- Prefer **explicit types** over `any`; use `unknown` when type is truly unknown
- Use **type imports** for types: `import type { Foo } from './bar'`
- Use **interfaces** for object shapes, **types** for unions/intersections
- **NO** `@ts-ignore` or `@ts-expect-error` without explanation

### React Components

- Use **functional components** with hooks (`React.FC` or direct function)
- **Named exports** preferred: `export function ComponentName() {}`
- **Client components** must have `'use client'` directive (if needed)
- Use **Tailwind CSS** for styling (utility classes, not inline styles)
- Use **lucide-react** for icons
- Use **Radix UI** primitives for complex UI components

### File Organization

- **Main process**: `src/main/services/`, `src/main/ipc/`, `src/main/db/`
- **Renderer**: `src/renderer/components/`, `src/renderer/hooks/`, `src/renderer/lib/`
- **Shared**: `src/shared/` for code used by both processes
- **Types**: `src/types/` for global type definitions
- Use **kebab-case** for file names: `workspace-terminal-panel.tsx`
- Use **PascalCase** for component files: `WorkspaceTerminalPanel.tsx`

### React Patterns

- **Hooks**: Always call hooks at the top level (no conditional hooks)
- **State**: Use `useState` for local state, context for shared state
- **Effects**: Clean up subscriptions/event listeners in `useEffect` return
- **Memoization**: Use `useMemo`/`useCallback` sparingly (only when needed)
- **Refs**: Use `useRef` for DOM refs or values that don't trigger re-renders

### IPC Communication

- **Main → Renderer**: Use `webContents.send('event-name', data)`
- **Renderer → Main**: Use `ipcRenderer.invoke('handler-name', args)`
- **Event listeners**: Always clean up in `useEffect` return
- **Type safety**: Define IPC types in `src/renderer/types/electron-api.d.ts`

### Error Handling

- **Main process**: Use `log.error()` from `../lib/logger`
- **Renderer**: Use `console.error()` or toast notifications
- **IPC errors**: Return `{ success: false, error: string }` format
- **User-facing errors**: Show friendly messages, log technical details

## 🗄️ Database & Migrations

- **ORM**: Drizzle ORM with SQLite
- **Migrations**: Generated in `drizzle/` directory
- **NEVER** manually edit `drizzle/meta/` or numbered migration files
- **Schema changes**: Modify `src/main/db/schema.ts`, then run `drizzle-kit generate`
- **Migration files**: Commit migration SQL files, but coordinate on schema changes

## 🌳 Git Workflow

### Branch Strategy

- **Default branch**: `main` (NEVER commit directly)
- **Feature branches**: Create from `main`, use descriptive names
- **Worktrees**: Use for parallel agent work (created automatically)

### Worktree Pattern

- Worktrees created in sibling `worktrees/` directory
- Each workspace gets its own worktree with unique branch
- Worktree paths: `../worktrees/{workspace-name}-{timestamp}`
- **IMPORTANT**: Agents run in worktree directories, not base repo

### Commit Messages

- Use conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`
- Be descriptive but concise
- Reference issues when applicable: `fix(agent): resolve worktree path issue (#123)`

## 🧪 Testing

- **Test files**: `src/**/*.test.ts` (Vitest)
- **Run tests**: `npx vitest run`
- **Test patterns**: Unit tests for utilities, integration tests for services
- **Mocking**: Mock Electron APIs and external services
- **Coverage**: Aim for critical paths (IPC handlers, services)

## 🚀 Development Environment Setup

### Prerequisites

```bash
# Node.js (use nvm)
nvm use  # Installs Node 22.20.0 if missing

# Optional but recommended:
npm install -g @openai/codex  # For Codex agent testing
npm install -g @anthropic-ai/claude-code  # For Claude Code testing
brew install gh  # GitHub CLI for GitHub integration
```

### First Time Setup

```bash
git clone <repo-url>
cd emdash
nvm use
npm run d  # Installs deps, rebuilds natives, starts dev server
```

### Hot Reload

- **Renderer changes**: Hot-reloads automatically via Vite
- **Main process changes**: Require Electron app restart
- **Native modules**: Require rebuild (`npm run rebuild`)

## 🔍 Common Patterns

### IPC Handler Pattern

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
  // Handle error
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
    // Fetch data via IPC
  }, [id]);
  
  return { data, loading };
}
```

## ⚠️ Common Pitfalls

1. **PTY Resize Errors**: PTYs must be cleaned up on exit. Use `removePty()` in exit handlers.
2. **Worktree Path Resolution**: Always resolve worktree paths from `WorktreeService` when creating agents.
3. **React Hooks Rules**: Never call hooks conditionally or after early returns.
4. **IPC Type Safety**: Always define types in `electron-api.d.ts` for IPC methods.
5. **Native Module Rebuilds**: After updating node-pty, sqlite3, or keytar, run `npm run rebuild`.
6. **Database Migrations**: Never manually edit migration files; use Drizzle Kit.
7. **Context Sections**: When working with diffs, ensure context sections are properly collapsed/expanded.

## 📚 Key Files & Utilities

### Core Services

- `src/main/services/WorktreeService.ts` - Git worktree management
- `src/main/services/AgentService.ts` - Agent orchestration (Claude Code, Codex)
- `src/main/services/CodexService.ts` - Codex-specific agent handling
- `src/main/services/DatabaseService.ts` - Database operations
- `src/main/services/ptyManager.ts` - PTY (terminal) management

### Core Components

- `src/renderer/components/ChatInterface.tsx` - Main chat interface
- `src/renderer/components/MultiAgentWorkspace.tsx` - Multi-agent workspace UI
- `src/renderer/components/RightSidebar.tsx` - File changes and terminal panel
- `src/renderer/components/ChangesDiffModal.tsx` - Diff viewer with syntax highlighting

### Utilities

- `src/renderer/lib/utils.ts` - General utilities
- `src/renderer/lib/languageUtils.ts` - Language detection for syntax highlighting
- `src/main/lib/logger.ts` - Logging utility

## 🎯 Workflow Best Practices

### When Adding Features

1. **Plan first**: Understand the architecture and where your code fits
2. **Create branch**: `git checkout -b feat/feature-name`
3. **Implement**: Follow code style guidelines
4. **Test**: Run type-check, lint, and tests
5. **Commit**: Use conventional commit messages
6. **PR**: Create PR with clear description

### When Fixing Bugs

1. **Reproduce**: Understand the issue fully
2. **Fix**: Make minimal changes to fix the issue
3. **Test**: Verify fix works and doesn't break other things
4. **Document**: Add comments if fix is non-obvious

### When Refactoring

1. **Small steps**: Break refactoring into small, testable commits
2. **Preserve behavior**: Ensure functionality remains the same
3. **Update tests**: Update tests to match new structure
4. **Type safety**: Maintain or improve type safety

## 🔐 Security & Privacy

- **Secrets**: Never commit API keys, tokens, or credentials
- **User data**: Database stored locally in OS userData folder
- **Logs**: Agent logs stored outside repos (in userData/logs/)
- **IPC**: Validate all IPC inputs, sanitize user-provided data
- **Native modules**: Be cautious with native module permissions

## 📝 Documentation

- **Code comments**: Add JSDoc comments for public APIs
- **README**: Update README.md for user-facing changes
- **CONTRIBUTING**: Follow CONTRIBUTING.md for development workflow
- **Changelog**: Consider updating changelog for significant changes

## 🐛 Debugging Tips

- **Main process logs**: Check terminal where `npm run dev:main` runs
- **Renderer logs**: Check browser DevTools (View → Toggle Developer Tools)
- **IPC debugging**: Add `log.debug()` calls in IPC handlers
- **Database**: SQLite file location logged on startup
- **Worktrees**: Check `worktrees/` directory for created worktrees
- **PTY issues**: Check `ptyManager:resizeAfterExit` warnings

## 🎨 UI/UX Guidelines

- **Dark mode**: Support both light and dark themes
- **Accessibility**: Use semantic HTML, ARIA labels where needed
- **Responsive**: Ensure UI works at different window sizes
- **Loading states**: Show loading indicators for async operations
- **Error states**: Display user-friendly error messages
- **Toast notifications**: Use toast for non-blocking notifications

---

**Remember**: This is a living document. Update it as patterns evolve and new best practices emerge. Use `#` in Claude Code to automatically incorporate improvements into this file.
