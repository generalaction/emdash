# Build Phases

Three phases. The merge gate before merging anything:

```bash
pnpm run format && pnpm run lint && pnpm run typecheck && pnpm run test
```

---

## Phase 0 — Engine Swap (invisible to users)

**Goal:** Rocky Proxy replaces CLI agent spawning. No UX regression. Existing terminal
rendering continues to work alongside new structured-card rendering so both can be
tested simultaneously before Phase 1 cuts over.

**Exit condition:** a chat session driven by Rocky Proxy emits structured event cards
(text, thinking, tool_call approval, plan) correctly in the renderer. Terminal fallback
still available via a dev flag.

### Tasks

1. **Rocky Proxy client stub**
   - Create `src/main/core/rocky-proxy/rocky-proxy-client.ts`
   - Implement a mock transport that emits synthetic events on a timer (useful for UI work)
   - Document expected real transport (HTTP SSE or WebSocket) in a `TODO:` comment referencing `agents/rocky/rocky-proxy.md`

2. **Rocky Proxy service + session registry**
   - Create `src/main/core/rocky-proxy/rocky-proxy-service.ts`
   - Forward events from client to renderer via `src/main/lib/events.ts`
   - Create `src/main/core/rocky-proxy/session-registry.ts` mapping `conversationId → sessionId`

3. **Rocky Proxy controller + RPC**
   - Create `src/main/core/rocky-proxy/controller.ts` with: `startSession`, `sendMessage`, `stopSession`, `respondToApproval`, `setModel`
   - Register in `src/main/rpc.ts`

4. **Shared types**
   - Create `src/shared/core/rocky-proxy/types.ts` and `events.ts`
   - All Rocky Proxy event payload types live here (see `agents/rocky/rocky-proxy.md`)

5. **Renderer event hook**
   - Create `src/renderer/features/tasks/conversations/use-rocky-proxy-events.ts`
   - Subscribe to the typed event channel, return a stream of typed events

6. **Structured event cards** (can be done in parallel with 1–5)
   - Create stub card components in `src/renderer/features/tasks/conversations/`:
     - `TextMessageCard.tsx`
     - `ThinkingCard.tsx`
     - `ActionApprovalCard.tsx`
     - `ActionResultCard.tsx`
     - `PlanPanel.tsx`
   - Wire them to the event hook in a new `RockyProxyConversationPane.tsx`

7. **Wiring in the task view**
   - Add a `useRockyProxy` feature flag (environment variable `ROCKY_PROXY=1` is enough)
   - When set, render `RockyProxyConversationPane` instead of the PTY pane in `src/renderer/features/tasks/conversations/`

---

## Phase 1 — MVP Co-worker

**Goal:** A non-developer can complete a real multi-step task with at least one external
action (approved inline) and view the result in the Artifact Panel. No git, terminal, or
code terms visible.

**Exit condition:** home screen shows workspaces + "New chat"; chat has model picker +
mode switcher + @-mention; an action approval card works; an artifact appears in the
right panel; settings has Permissions & auto-run.

### Tasks (ordered by dependency)

**1. Home / Welcome rewrite**
- `src/renderer/app/welcome.tsx` — remove four repo actions; add chat entry box, "New workspace" button, recent chats
- `src/renderer/app/home-view.tsx` — workspaces list + running agents strip + "New chat" quick-entry
- Update sidebar nav: Home · Workspaces · Automations · Marketplace · Settings (remove Library, rename correctly)

**2. Chat composer + mode switcher**
- Remove agent provider picker from task config
- Add mode switcher (Ask / Agent / Plan) to the chat composer
- Add model picker (friendly names only — "Most capable", "Faster", etc.) — calls `rpc.rockyProxy.setModel`
- Add context gauge to the composer header (updates from `usage` events)

**3. @-mention context picker**
- Create `src/renderer/features/tasks/conversations/context-mention-picker.tsx`
- Trigger on `@` keypress in the composer
- Sources: workspace folders/files, connected apps (list from `rpc.connectedApps.list`), past chats, images (drag/paste)
- Attach selected items to `startSession` call as `context: ContextAttachment[]`

**4. Inline action-approval cards** (builds on Phase 0 card stubs)
- Flesh out `ActionApprovalCard.tsx`: show connector name, action description, expandable detail, Approve / Deny / Edit buttons
- Wire Approve → `rpc.rockyProxy.respondToApproval({ decision: 'approve' })`
- Wire Deny → `rpc.rockyProxy.respondToApproval({ decision: 'deny' })`
- Wire Edit → inline edit form, then approve with edited input

**5. Artifact Panel** (can be done in parallel with 3–4)
- Implement `src/renderer/features/artifact-panel/` per `agents/rocky/artifact-panel.md`
- Phase 1 must-have renderers: `document-renderer`, `table-renderer`, `diagram-renderer`, `web-renderer` (sandboxed)
- Wire to Rocky Proxy `artifact` and `artifact_update` events
- Implement version store and version picker
- Implement Accept / Reject buttons

**6. Workspace reframe**
- Rename "Project" → "Workspace" in all user-facing strings in `src/renderer/features/projects/`
- Workspace detail screen: replace repo/branch/SSH with Documents (folder tree) + Connected Apps (connector toggles) + Workspace rules (text input)
- New RPC: `rpc.connectedApps.list(workspaceId)` → connectors enabled for this workspace
- New service: `src/main/core/connected-apps/connected-apps-service.ts`

**7. Settings reshape**
- Remove tabs: Agents, Repository from settings view
- Add tab: **Permissions & auto-run** — Cursor-style per-connector policy UI
- Add tab: **Rules / instructions** — persistent user-level and workspace-level text instructions
- New service: `src/main/core/permissions/permissions-service.ts`
- Default policies: reads = `auto_run`; external writes/sends = `ask`

**8. Automations elevation**
- Already fully built (`src/renderer/features/automations/`)
- Move to top-level nav (already in sidebar, confirm it is accessible without opening a project)
- No functional changes needed in Phase 1; public/private sharing is Phase 2

**9. Hide developer surfaces**
- Remove terminal panes from task view rendering path (keep the code, gate it behind `DEV_MODE`)
- Remove diff view from task tabs (keep the code)
- Remove agent-provider picker, session flags, branch config from task config UI
- Remove Agents and Repository tabs from settings

**10. Background agents + notifications**
- Ensure "waiting for approval" is a first-class status in the running-agents strip on Home
- OS notification fires when a backgrounded session emits `approval_request`
- One-click jump from notification to the exact approval card in the chat

---

## Phase 2 — Pillars Complete

**Goal:** All five product pillars are functional end-to-end. A maker can create and
publish a Skill; a user can install a Smithery connector; an automation runs on schedule
with approval gates; connected-app @-mentions pull live context.

### Tasks

**1. Marketplace UI** (absorbs existing Skills and MCP views)
- Implement `src/renderer/features/marketplace/` per `agents/rocky/marketplace.md`
- Four tabs: Skills · Connectors · Smithery · My items
- Smithery: `src/main/core/smithery/` new module, Bearer token in safe storage
- Public/private badges on all user-created items (Phase 2 = badge only; publishing via backend is Phase 2b)

**2. Smithery connector install**
- `src/main/core/smithery/smithery-service.ts` — search registry, install local (stdio) and hosted (HTTP/SSE) servers
- Installs flow into existing `McpService` so the connector immediately appears in Connectors tab

**3. Skill authoring and publishing**
- Flesh out `CreateSkillModal` (already exists as a stub) — name, description, instructions, required connectors, tags
- "Publish → Public" flow: Phase 2 = export as JSON for manual sharing; Phase 2b = post to self-deployed backend

**4. Connected-app @-mentions (live context)**
- `context-mention-picker.tsx` sources real data: Gmail thread list, CRM contact search, Drive file search
- Each connector contributes a `ContextProvider` that responds to the picker query
- New shared interface: `ContextProvider.search(query: string): Promise<ContextItem[]>`

**5. Edit-with-Claude in artifacts**
- `document-renderer.tsx` — add text selection → floating "Edit this" action
- Wire to `rpc.rockyProxy.sendMessage` with the selection as a scoped edit instruction

**6. Friendly Undo / Checkpoints**
- Surface checkpoint concept in the chat stream (Rocky Proxy emits a `checkpoint` event after completing actions)
- "Undo to here" button on checkpoint cards
- Calls `rpc.workspace.rollbackToCheckpoint(checkpointId)` → triggers git reset under the hood (never shown to user)

**7. Rules / instructions**
- User-level rules: stored in settings DB, sent to Rocky Proxy as a system instruction prefix
- Workspace-level rules: stored per workspace, merged with user-level rules

**8. Onboarding**
- `src/renderer/features/onboarding/` — sign-in → connect apps → pick role pack → first-chat nudge
- Role packs seed default Connectors + Skill suggestions (not custom code — just pre-filled settings)

---

## Phase 3 — Polish & Depth

Deferred items (do not build in Phase 1 or 2):

- In-panel WYSIWYG editing for slides/sheets
- Export to Google Docs/Slides/Sheets
- Usage/cost dashboard in Settings → Account & usage
- Broader Smithery-hosted connector OAuth (Smithery Connect managed auth)
- Admin / curation layer for public Marketplace items
- Rocky desktop design pass (typography, spacing, color system)
- Richer @-mention sources (meeting notes, calendar events, Slack threads)

---

## What to Never Do During the Build

- Do not hand-edit files in `drizzle/` or `drizzle/meta/` — use `pnpm run db:generate`
- Do not delete PTY machinery (`src/main/core/pty/`, `src/renderer/lib/pty/`) — gate it behind flags
- Do not delete diff machinery (`src/renderer/features/tasks/diff-view/`) — it powers checkpoints under the hood
- Do not weaken the sandboxing on the web/HTML artifact renderer
- Do not store Rocky Proxy tokens, Smithery tokens, or provider credentials in plain SQLite fields — use Electron safe storage
- Do not dispatch release workflows (`release-prod.yml`, `release-canary.yml`) unless explicitly asked
