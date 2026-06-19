# Transformation Map: emdash → Rocky

All paths are relative to `apps/rocky-desktop/` unless prefixed with the repo root.

This is the authoritative reference for what to keep, change, remove, and add when
building Rocky from the emdash codebase. Check this before touching any file.

---

## KEEP — No Changes Required

The following are infrastructure that Rocky uses directly. Do not restructure them
unless a task explicitly requires it.

**Main-process infrastructure (keep as-is):**
- `src/main/core/pty/` — PTY machinery (now hidden from UI but still powers Rocky Proxy sessions until engine swap is complete)
- `src/main/core/ssh/` — SSH connection management
- `src/main/core/db/` — Database (SQLite + Drizzle)
- `src/main/lib/` — Logger, events, result type
- `src/main/core/automations/` — Automations engine and scheduler (keep all; UI elevated in Phase 1)
- `src/main/core/mcp/` — MCP server management (keep all; exposed via Marketplace as "Connectors")
- `src/main/core/skills/` — Skills backend and bundled catalog (keep all; exposed via Marketplace)
- `src/main/core/settings/` — Settings service and schema (keep; UI reshaped)
- `src/main/core/notifications/` (if present) — Keep
- `src/main/core/agent-hooks/` — Hook server and OS notification dispatch (keep)
- `src/main/core/workspaces/` — Workspace/worktree machinery (keep; UX reframed)
- `src/main/core/projects/` — Project services (keep internals; surface renamed)
- `src/main/core/search/` — Keep
- `src/main/core/updates/` — Auto-update (keep)
- `src/main/core/telemetry/` — Keep (telemetry stays optional)
- `src/main/rpc.ts` — RPC router (keep pattern; add new controllers)

**Renderer infrastructure (keep as-is):**
- `src/renderer/lib/` — All of: MobX stores, React hooks, modal infrastructure, command registry; keep everything except `src/renderer/lib/pty/` which is only removed from UI (the module stays)
- `src/renderer/app/modal-registry.ts` — Keep pattern; add new Rocky modals
- `src/renderer/app/view-registry.ts` — Keep pattern; add/replace views

**Shared types (keep as-is):**
- `src/shared/core/automations/` — All automation types
- `src/shared/core/mcp/` — All MCP types
- `src/shared/core/skills/` — All skills types
- `src/shared/ipc/` — RPC and event primitives (unchanged)
- `src/shared/core/tasks/` — Internal task types (keep; "task" is an internal concept, "Chat" is UI-only)

**Feature UIs to keep largely unchanged:**
- `src/renderer/features/automations/` — Keep all; elevate to top-level nav and add public/private sharing (Phase 1)
- `src/renderer/features/command-palette/` — Keep; reword "New Project" → "New workspace"

---

## CHANGE — Keep File, Modify Contents

### Home / Welcome

| File | What to change |
|---|---|
| `src/renderer/app/welcome.tsx` | Replace the four repo actions ("Open project", "Create repository", "Clone from GitHub", "Add remote project") with: a "What do you want to get done?" chat box, "New workspace" button, "Connect an app" link, "Examples" / recent chats list. Remove all git/SSH language. |
| `src/renderer/app/home-view.tsx` | Reframe: Workspaces list (recent first) + "Running agents" status strip + "New chat" quick-entry. No repo/branch/PR references. |

### Navigation

| File | What to change |
|---|---|
| `src/renderer/app/view-registry.ts` | Add views: `marketplace`, `artifact-panel` (or integrate as panel state). Rename "library" → "marketplace". Remove (or guard-hide): `repository`, `pull-requests`, `diff` as standalone routes. Keep: `home`, `workspace` (was project), `automations`, `settings`. |
| `src/renderer/features/sidebar/` | Top-level nav items: Home · Workspaces · Automations · Marketplace · Settings. Remove "Library" (folded into Marketplace). Add "Marketplace". Keep "Automations" as first-class. |

### Settings

| File | What to change |
|---|---|
| `src/renderer/features/settings/settings-view.tsx` | Tab list becomes: General · Connected apps · Models · **Permissions & auto-run** · **Rules/instructions** · Notifications · Account & usage. Remove: Agents, Repository, Connections (fold into Connected apps). |
| `src/renderer/features/settings/agents-page/` | Remove entirely from UI. The agent provider registry and PTY settings are no longer user-accessible in Rocky. |
| `src/renderer/features/settings/components/` | Keep components that are reused; delete/disable anything that references CLI paths, session flags, branch prefixes, SSH hosts, tmux, worktree, auto-approve flag, keystroke injection. |

### Workspace (was Project)

| File | What to change |
|---|---|
| `src/renderer/features/projects/` | Rename directory to `src/renderer/features/workspaces/` when convenient; otherwise rename UI labels. The workspace detail screen shows: **Documents** (folder tree — local + Drive) and **Connected apps** (which Connectors are available in this workspace, toggleable) and **Workspace rules** (persistent instructions). Remove: repo URL, default branch, SSH host, BYOI, branch strategy. |
| `src/renderer/features/projects/stores/` | Keep all MobX stores and selectors; update user-facing string literals. |

### Chat (was Task/Conversation)

The task view is the heart of the change. Do **not** rewrite from scratch — reshape.

| File | What to change |
|---|---|
| `src/renderer/features/tasks/view.tsx` | Layout changes: left sidebar = chat list; center = chat panel; right = **Artifact Panel** (new). Remove the tab bar that switches between terminal / diff / editor. |
| `src/renderer/features/tasks/main-panel.tsx` | Remove terminal tab. Remove diff/PR tab. Center panel is now the chat stream + composer only. |
| `src/renderer/features/tasks/task-titlebar.tsx` | Remove git-related controls (branch picker, PR button, commit controls). Keep: chat name, model picker, mode switcher (Ask/Agent/Plan), stop/pause, background-agent indicator. |
| `src/renderer/features/tasks/conversations/` | The conversation message stream must render **structured event cards** (text, thinking, tool-call with approval card, tool-result, plan/to-do list) instead of embedding a PTY pane. Keep the conversation CRUD and history; replace the rendering layer. See `agents/rocky/rocky-proxy.md` for event shapes. |
| `src/renderer/features/tasks/task-config/` | Remove or hide: agent provider picker, session flags, keystroke settings, branch/worktree config. Keep or add: workspace/context selector, model picker, mode switcher. |

### Library → Marketplace

| File | What to change |
|---|---|
| `src/renderer/features/library/library-view.tsx` | Evolve into `src/renderer/features/marketplace/marketplace-view.tsx`. Four tabs: Skills · Connectors · Smithery · My items. The existing Prompts tab becomes the Skills tab foundation; MCP management becomes the Connectors tab. See `agents/rocky/marketplace.md`. |
| `src/renderer/features/mcp/mcp-view.tsx` | Fold into the Marketplace "Connectors" tab instead of a standalone view. The MCP component logic is reused. |
| `src/renderer/features/skills/skills-view.tsx` | Fold into the Marketplace "Skills" tab. Keep all skill hooks and service calls. |

---

## REMOVE — Delete or Permanently Hide

Do not remove backend machinery; remove or hide only the UI surfaces listed here.

| What | Why |
|---|---|
| `src/renderer/features/tasks/terminals/` | PTY terminal panes must not appear in Rocky. The PTY machinery in `src/renderer/lib/pty/` stays (it is used internally); the terminal UI components are removed from rendering. |
| `src/renderer/features/tasks/diff-view/` | Replace entirely with the Artifact Panel (see `agents/rocky/artifact-panel.md`). The underlying git-based change tracking that powers checkpoints/undo continues to run; only the diff-review UI is removed. |
| `src/renderer/features/tasks/editor/` | The Monaco editor moves inside the Artifact Panel for document editing. Remove as a standalone task tab. |
| Developer Settings tabs | Remove from the settings tab list: Agents (provider registry), Repository (branch strategy, worktree config), Connections (SSH hosts). These are dev-only; Rocky users should never see them. |
| `src/renderer/app/welcome.tsx` repo actions | "Create repository", "Clone from GitHub", "Add remote project (SSH)" — remove these entry points. |
| `agents/integrations/providers.md` references in UI | The 33-entry agent provider registry still exists in `src/shared/agent-provider-registry.ts` (do not delete it) but is never surfaced to Rocky users. |

---

## ADD — New Files / Modules

### Artifact Panel
New feature: `src/renderer/features/artifact-panel/`  
Full spec: `agents/rocky/artifact-panel.md`

### Marketplace (unified)
New feature directory: `src/renderer/features/marketplace/`  
Absorbs: existing `features/skills/` and `features/mcp/` UI  
Full spec: `agents/rocky/marketplace.md`

### Rocky Proxy session module (main process)
New module: `src/main/core/rocky-proxy/`  
Replaces: CLI agent spawning via PTY for the primary chat session  
Full spec: `agents/rocky/rocky-proxy.md`

### Permissions & auto-run
New module: `src/main/core/permissions/`  
New settings page component: `src/renderer/features/settings/permissions-page/`  
Purpose: Cursor-style per-connector/tool policy (always ask / ask for writes / auto-run allowlist)

### Connected Apps (workspace-level)
New service: `src/main/core/connected-apps/`  
Purpose: tracks which Connectors are enabled per-workspace; drives @-mention picker

### Shared types for new domains
- `src/shared/core/rocky-proxy/` — Rocky Proxy event and session types
- `src/shared/core/artifact/` — Artifact type definitions (document, table, diagram, web, image, code, pdf)
- `src/shared/core/permissions/` — Permission rule types (allowlist, policy per tool)

### Workspace detail screen
New components in `src/renderer/features/workspaces/`:
- `workspace-documents.tsx` — folder tree view (local + Drive folders)
- `workspace-connected-apps.tsx` — connector toggle per workspace
- `workspace-rules.tsx` — persistent instructions editor

### @-mention context picker
New component in `src/renderer/features/tasks/conversations/`:
- `context-mention-picker.tsx` — @-mention overlay for documents, folders, connected apps, past chats, images

### Inline action-approval cards
New components in `src/renderer/features/tasks/conversations/`:
- `action-approval-card.tsx` — inline Approve / Deny / Edit card for external actions
- `action-result-card.tsx` — completed action record in the chat stream

### Onboarding
New feature: `src/renderer/features/onboarding/`  
Screens: sign-in → connect apps → pick role pack → first-chat nudge

---

## What Does NOT Change (do not touch)

- `drizzle/` migrations — add new ones with `pnpm run db:generate`; never hand-edit
- `src/main/core/pty/` internals — still powers Rocky Proxy sessions; no PTY behavioral changes
- `src/main/core/ssh/` — unchanged
- `src/main/core/mcp/services/McpService.ts` — the backend; only the UI surface changes
- `src/preload/index.ts` — keep the minimal preload bridge
- Build system, CI, release workflows — untouched unless explicitly asked
- Path aliases in `tsconfig.json` / `electron.vite.config.ts` — add new aliases only if needed
