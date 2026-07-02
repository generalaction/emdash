# Renderer

All paths are relative to `apps/emdash-desktop/`.

## Main Entry Points

- `src/renderer/main.tsx`: renderer bootstrap
- `src/renderer/App.tsx`: top-level provider composition
- `src/renderer/app/workspace.tsx`: main post-onboarding shell
- `src/renderer/app/view-registry.ts`: view definitions and navigation guards; switches between views
- `src/renderer/lib/ipc.ts`: typed RPC client (`rpc`) and event emitter (`events`) used throughout renderer

## App Shell (`src/renderer/app/`)

- `workspace.tsx`, `home-view.tsx`, `welcome.tsx` — shell and top-level views
- `modal-registry.ts` — central modal registry; all modals are registered here
- `view-registry.ts` — central view registry; all views are registered here
- `app-menu-events.tsx` — native app menu event wiring

## Feature Areas (`src/renderer/features/`)

- `tasks/` — task experience: `conversations/`, `diff-view/`, `editor/` (Monaco),
  `file-tree/`, `terminals/`, `acp/` (maps ACP updates into `@emdash/chat-ui`, see
  `agents/integrations/acp.md`), `create-task-modal/`, `issue-context/`, `task-config/`,
  `components/`, `task-tab-registry.tsx` (tab definitions — no `tabs/` subdirectory),
  `stores/` (MobX task stores and `task-selectors.ts`), `hooks/`, `view/`
- `projects/` — project management, settings panel, branch selector; `stores/` holds
  project stores and `project-selectors.ts`
- `sidebar/` — app sidebar
- `mcp/` — MCP server management UI (`mcp-view.tsx`, `components/`)
- `skills/` — skills catalog and management
- `integrations/` — integration management (GitHub, GitLab, Jira, Linear, ...)
- `settings/` — settings view
- `automations/`, `browser/`, `command-palette/`, `library/`, `onboarding/`

## Shared Renderer Infrastructure (`src/renderer/lib/`)

- `ipc.ts` — typed RPC client and event emitter
- `modal/` — modal provider, renderer, store, and close-guard infrastructure
- `layout/` — layout, navigation, and panel drag providers
- `commands/` — command registry (`registry.ts`) and view-level `commandProvider` hooks
- `pty/` — frontend PTY sessions, pool provider, panes, prompt injection
- `monaco/`, `editor/` — Monaco editor integration
- `stores/` — cross-feature stores (navigation, dependencies, resource monitor, ...)
- `providers/`, `hooks/`, `components/`, `ui/`, `theme/` — shared providers, hooks, and UI primitives

## Tests

- Renderer unit tests: `src/renderer/tests/`
- Playwright-backed browser tests: `src/renderer/tests/browser/`

## When Editing Here

- Check `agents/conventions/renderer-patterns.md` for modal, view, PTY frontend, and store patterns.
- Call RPC methods via the typed `rpc` client from `src/renderer/lib/ipc.ts`
  (alias `@renderer/lib/ipc`), e.g. `rpc.tasks.create(...)`.
- New modals must be registered in `src/renderer/app/modal-registry.ts`.
- New views must be registered in `src/renderer/app/view-registry.ts`.
- The preload bridge (`src/preload/index.ts`) exposes only `invoke`, `eventSend`,
  `eventOn`, and `getPathForFile` on `window.electronAPI`; keep renderer-main calls on
  typed RPC and typed events.
