# Renderer

## Main Entry Points

- `src/renderer/App.tsx`: top-level provider composition
- `src/renderer/views/Workspace.tsx`: main post-onboarding shell
- `src/renderer/components/MainContent.tsx`: switches between views (projects, tasks, settings, skills, MCP, home)
- `src/renderer/core/ipc.ts`: typed RPC client (`rpc`) and event emitter (`events`) used throughout renderer

## View Areas (`src/renderer/views/`)

- `projects/` — project management: active project, pending project, create task modal, settings panel, task panel, branch selector, titlebar
- `tasks/` — task experience:
  - `conversations/` — conversation panel and tabs
  - `diff-viewer/` — file changes panel, diff views (file, stacked), PR section, git state providers
  - `editor/` — Monaco code editor, file tree, editor providers, conflict dialog
  - `terminals/` — terminal panel and tabs
  - `hooks/` — task-scoped hooks (use-task, use-conversations, use-terminals, use-task-view-navigation)
- `settings/` — settings view
- `home-view.tsx`, `mcp-view.tsx`, `skills-view.tsx`, `Welcome.tsx`

## Component Areas (`src/renderer/components/`)

- `sidebar/` — app sidebar
- `diff/` — diff-related components
- `skills/` — skills catalog and management
- `mcp/` — MCP server management
- `kanban/` — kanban board
- `integrations/` — integration management
- `ssh/` — SSH connection UI
- `FileExplorer/` — file tree navigation
- `settings/` — settings components
- `projects/` — project-related components
- `ui/` — shared UI primitives

## Supporting Structure

- Context providers: `src/renderer/contexts/`
- Hooks: `src/renderer/hooks/`
- Client-side state helpers, stores, and utilities: `src/renderer/lib/`
- Core infrastructure: `src/renderer/core/` (IPC client, modals, project state, PTY helpers, view management)

## When Editing Here

- Check `agents/conventions/renderer-patterns.md` for modal, view, PTY frontend, and context patterns.
- Call RPC methods via the typed `rpc` client from `src/renderer/core/ipc.ts` (e.g., `rpc.tasks.create(...)`).
- New modals must be registered in `src/renderer/core/modal/registry.ts`.
- New views must be registered in `src/renderer/core/view/registry.ts`.
- Only methods in `src/renderer/types/electron-api.d.ts` use direct `window.electronAPI` calls (PTY ops, fsList, openIn).
- If you change user-visible workflows, update the matching page in `docs/` when appropriate.
