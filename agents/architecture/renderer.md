# Renderer

## Main Entry Points

- `src/renderer/App.tsx`: top-level provider composition
- `src/renderer/views/Workspace.tsx`: main post-onboarding shell
- `src/renderer/components/MainContentArea.tsx`: switches between chat, multi-agent, project, settings, skills, MCP, kanban, and home views
- `src/renderer/components/ChatInterface.tsx`: single-task chat and terminal workflow
- `src/renderer/components/MultiAgentTask.tsx`: multi-agent task experience
- `src/renderer/components/ProjectMainView.tsx`: project dashboard when no task is active
- `src/renderer/components/TaskModal.tsx` and `TaskAdvancedSettings.tsx`: task creation and advanced options

## Feature Areas

- Diff review:
  - `src/renderer/components/diff*`
  - `src/renderer/components/FileChangesPanel.tsx`
- Skills:
  - `src/renderer/components/skills/`
- MCP:
  - `src/renderer/components/mcp/`
- Kanban:
  - `src/renderer/components/kanban/`
- Integrations:
  - `src/renderer/components/integrations/`
- SSH:
  - `src/renderer/components/ssh/`

## Supporting Structure

- Context providers live under `src/renderer/contexts/`.
- Hooks live under `src/renderer/hooks/`.
- client-side state helpers and stores live under `src/renderer/lib/`.

## When Editing Here

- Keep renderer IPC usage in sync with `src/renderer/types/electron-api.d.ts`.
- If you change user-visible workflows, update the public docs site when appropriate.
