# Emdash Internal MCP — Implementation Spec

Design doc for exposing emdash itself as an MCP server that agents inside emdash conversations can call. Two distinct toolsets:

1. **Set A — Agent collaboration**: agents on the same task talk to each other, spawn siblings, observe state.
2. **Set B — Emdash automation**: agents drive the emdash UI / data model — list projects, create tasks, switch layouts, etc. Replaces tedious clicks.

The reporting/observability tools (status, tasks, notify) live alongside Set A as core infrastructure.

---

## 1. Goals & non-goals

### Goals
- Expose emdash to running agent CLIs as a standard MCP server, installable via the existing emdash MCP page.
- Per-conversation identity for every MCP request — server knows which conversation called.
- Two-way agent collaboration: read peer state, send messages, spawn / close peers.
- Drive emdash without UI: project / task / conversation CRUD, view switching.
- Cross-task talk allowed but discouraged via explicit flags + audit signal.
- Minimal tool count — fewer well-shaped tools over many narrow ones.

### Non-goals (v1)
- ACP transport — defer until industry standardizes (revisit when Zed pattern stabilizes).
- Emdash-internal message persistence DB — read transcripts on-demand from each provider's own files.
- Browser / web client — same trick can later, but v1 is for in-process agent CLIs only.
- Cross-emdash-instance talk — single instance only.

---

## 2. Reuse map

| Need | Reuse | New |
|------|-------|-----|
| Per-provider config writing | `mcpService.saveServer()` + adapters in `src/main/core/mcp/` | — |
| Catalog UI entry | `catalogData` in `src/shared/mcp/catalog.ts` | + 1 entry (`emdash`) |
| App boot wiring | existing app init | hook to refresh emdash entry with current port/instance |
| Conversation creation | existing flow in `src/main/core/conversations/operations/createConversation.ts` | inject `EMDASH_*` env vars at PTY spawn |
| PTY I/O | `PtySession` (already manages stdin/stdout per conversation) | call `session.write()` for `agent_send`, `\x03` for interrupt |
| AgentStatus | existing `AgentStatus` enum + ConversationStore status | expose via HTTP loopback |
| Hook events | `src/main/core/agent-hooks/hook-server.ts` (already buffers events) | extend in-memory buffer to be queryable per conversation |
| Conversations / tasks / projects RPC | existing controllers | reuse from inside HTTP handlers |
| MCP subprocess binary | — | new electron-vite entry `src/mcp-server/` |
| HTTP loopback | — | new module `src/main/core/mcp-internal/` |

---

## 3. High-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Emdash main process                                            │
│                                                                 │
│  ┌──────────────────────────────┐   ┌──────────────────────┐    │
│  │  MCP Internal HTTP Server    │   │  Existing managers   │    │
│  │  127.0.0.1:<port>            │◀─▶│  ProjectManager      │    │
│  │  • token auth (instance ID)  │   │  TaskManager         │    │
│  │  • routes per Set A / Set B  │   │  ConversationMgr     │    │
│  │  • capability gating         │   │  PtySessionRegistry  │    │
│  └──────────────────────────────┘   └──────────────────────┘    │
│           ▲                                                     │
│           │ HTTP                                                │
└───────────┼─────────────────────────────────────────────────────┘
            │
            │ (loopback)
            │
┌───────────┴─────────────────────────────────────────────────────┐
│  emdash-mcp subprocess (per-conversation, stdio)                │
│  Runs as MCP server for the agent CLI.                          │
│                                                                 │
│  • reads EMDASH_* env on startup                                │
│  • exposes Set A + Set B tools                                  │
│  • each tool call → HTTP request to status server               │
│  • adds X-Emdash-Token, X-Emdash-Session-Id headers             │
└─────────────────────────────────────────────────────────────────┘
            ▲
            │ stdio (MCP)
            │
┌───────────┴─────────────────────────────────────────────────────┐
│  Agent CLI (Claude Code / Codex / Copilot / etc)                │
│  Spawned by emdash via PTY with env:                            │
│    EMDASH_INSTANCE_ID, EMDASH_SESSION_ID,                       │
│    EMDASH_TASK_ID, EMDASH_PROJECT_ID, EMDASH_STATUS_URL,        │
│    EMDASH_TOKEN                                                 │
│                                                                 │
│  Reads its own MCP config (e.g. ~/.claude.json), spawns         │
│  emdash-mcp as a child. Child inherits PTY env.                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Identity flow (the critical part)

Every conversation in a task shares one worktree. Per-conversation `.mcp.json` would collide. Solution: identity travels via **PTY inherited environment**, not the static `env` block in the catalog entry.

### Spawn sequence (per conversation)
1. Emdash conversation creation calls `pty.spawn(cli, args, {env})` with:
   ```
   EMDASH_INSTANCE_ID=<app-launch-uuid>      # static for whole emdash run
   EMDASH_SESSION_ID=<conversationId>         # ← unique per conversation
   EMDASH_TASK_ID=<taskId>
   EMDASH_PROJECT_ID=<projectId>
   EMDASH_STATUS_URL=http://127.0.0.1:<port>
   EMDASH_TOKEN=<rotated-per-launch>          # bearer token
   ```
2. CLI inherits env from PTY parent.
3. CLI reads its own MCP config (e.g. `~/.claude.json`). The emdash entry in that file has `command: <emdash-mcp-bin>` and either an empty `env: {}` or only `EMDASH_INSTANCE_ID` / `EMDASH_STATUS_URL` (which are static per emdash launch). **No per-conversation values in the static config.**
4. CLI spawns emdash-mcp as a child. By default child inherits parent env (Node child_process / similar). So emdash-mcp sees `EMDASH_SESSION_ID` set to the running conversation's ID.
5. emdash-mcp on startup reads `process.env.EMDASH_*` — that's its identity.
6. Every HTTP request from emdash-mcp carries `Authorization: Bearer ${EMDASH_TOKEN}` and `X-Emdash-Session-Id: ${EMDASH_SESSION_ID}`.
7. Emdash HTTP server validates: token matches current launch, session ID is a live conversation, instance ID matches. Reject otherwise.

### Why `env` in the static catalog must not contain per-conv values
The MCP spec says the per-server `env` field, when non-empty, replaces matching env keys at spawn. If we put `EMDASH_SESSION_ID` there, every conversation gets the same session ID and identity collapses. Keep static values only.

### Refreshing the catalog entry on app boot
`EMDASH_INSTANCE_ID` and the loopback port change every launch. On app start:
1. Generate a fresh instance UUID.
2. Allocate a port (random in 33000–33999, like omniscribe).
3. Build the canonical `McpServer` for emdash with the new values.
4. Call `mcpService.saveServer()` with `providers` = the set the user has previously enabled for this server. Existing service rewrites every selected provider's config with current values.

The user installs emdash MCP once via the MCP UI. After that, app boot keeps configs fresh.

---

## 5. HTTP loopback API

Single base URL: `http://127.0.0.1:<port>`. All requests carry headers:
- `Authorization: Bearer <EMDASH_TOKEN>`
- `X-Emdash-Instance-Id: <id>`
- `X-Emdash-Session-Id: <conversationId>`

Server validates: token matches, instance matches, session ID is live. Otherwise 401 / 410. Each route's caller scope (the conversation running the agent) is taken from `X-Emdash-Session-Id`; routes don't accept a `callerId` body field.

### Set A endpoints (agent collaboration)

| Method + path | Tool name | Body / query | Response |
|---|---|---|---|
| `GET /agent/self` | `agent_self` | — | `{conversationId, taskId, projectId, providerId, name}` |
| `GET /agent/peers?scope=task\|project\|all` | `agent_list_peers` | scope query (default `task`) | `[{conversationId, providerId, name, status, lastActivityAt, taskId, projectId}]` |
| `POST /agent/spawn` | `agent_spawn` | `{providerId, name?, initialPrompt?, sameTask?: bool}` (default sameTask=true) | `{conversationId}` |
| `POST /agent/{conversationId}/send` | `agent_send` | `{message, crossTask?: bool}` | `{ok: true}` or 403 if cross-task without flag |
| `POST /agent/{conversationId}/interrupt` | `agent_interrupt` | — | `{ok: true}` |
| `GET /agent/{conversationId}/observe?waitForChange&timeoutMs` | `agent_observe` | optional long-poll params | `{status, recentEvents: [...up to 5], lastAssistantMessage?, providerTier, statusChangedAt}` |
| `GET /agent/{conversationId}/fetch?kind=events\|scrollback\|transcript&limit&since` | `agent_fetch` | kind + cursor | `{items: [...], nextCursor?, providerTier, transcriptSupported}` |
| `DELETE /agent/{conversationId}` | `agent_close` | — | `{ok: true}` |

### Set B endpoints (emdash driving)

Resource-noun routes. Below is the v1 surface; verbs map straight to existing controllers.

```
# Projects
GET    /projects                                project_list
GET    /projects/{id}                           project_get
POST   /projects/local                          project_create_local       (gated)
POST   /projects/clone                          project_create_clone        (gated)
PATCH  /projects/{id}/archived                  project_archive / unarchive
PATCH  /projects/{id}/appearance                project_set_appearance
POST   /projects/{id}/open                      project_open
DELETE /projects/{id}                           project_delete              (dangerous)

# Tasks
GET    /tasks?projectId=&includeArchived=       task_list
GET    /tasks/{id}                              task_get
POST   /tasks                                   task_create                 (gated)
PATCH  /tasks/{id}                              task_rename / pin           (gated)
PATCH  /tasks/{id}/archived                     task_archive / unarchive
POST   /tasks/{id}/open                         task_open
DELETE /tasks/{id}                              task_delete                 (dangerous)

# Conversations
GET    /conversations?taskId=                   conversation_list
POST   /conversations                           conversation_create        (subset of agent_spawn for cross-task)
PATCH  /conversations/{id}                      conversation_rename        (gated)
DELETE /conversations/{id}                      conversation_delete        (gated)
POST   /conversations/{id}/open                 conversation_open

# View / UI
PATCH  /view/layout                             view_layout_set
POST   /view/file                               view_open_file
POST   /view/diff                               view_open_diff
POST   /view/terminal                           view_terminal_open / close
PATCH  /view/sidebar                            view_sidebar_set

# Workspace inspection (current task scope)
GET    /workspace/diff?against=                 workspace_get_diff
GET    /workspace/files?glob=                   workspace_list_files
GET    /workspace/search?query=                 workspace_search
GET    /workspace/prs                           workspace_list_open_prs
GET    /workspace/dev-servers                   workspace_dev_servers
POST   /workspace/lifecycle                     workspace_run_lifecycle    (gated)
POST   /workspace/pr                            workspace_create_pr        (gated)
POST   /workspace/commit                        workspace_commit           (gated)

# Settings / extensions
GET    /skills                                  skills_list
POST   /skills                                  skills_install             (gated)
GET    /mcp                                     mcp_list
POST   /mcp                                     mcp_install                (dangerous)
DELETE /mcp/{name}                              mcp_remove                 (dangerous)
GET    /settings/{key}                          settings_get
PATCH  /settings/{key}                          settings_set               (dangerous)

# Reporting (one-way)
POST   /report/status                           report_status
POST   /report/tasks                            report_tasks
POST   /report/notify                           notify
POST   /report/request-input                    request_input              (long-poll)
```

### Capability gating

Three buckets per task. Persisted on the task. UI surfaces toggles in task settings.

- `core` — Set A (excluding cross-task writes) + read-only Set B + reporting. Always on.
- `driving:write` — write tools tagged `(gated)` above. User opts in.
- `driving:dangerous` — tools tagged `(dangerous)`. Explicit opt-in with confirmation dialog.

Cross-task variants:
- `cross-task:read` — `agent_list_peers(scope:'project'\|'all')`, `agent_observe`, `agent_fetch` across tasks. Default on.
- `cross-task:write` — `agent_send(crossTask:true)`, `agent_interrupt` cross-task. Default off.

Server checks capability bucket vs. caller's task on every request.

---

## 6. MCP tool surface (locked)

### Set A — 8 tools

| Tool | Params | Returns |
|---|---|---|
| `agent_self` | — | `{conversationId, taskId, projectId, providerId, name}` |
| `agent_list_peers` | `scope?: 'task'\|'project'\|'all'` (default task) | array of peer summaries |
| `agent_spawn` | `providerId, name?, initialPrompt?, sameTask?: bool` (default true) | `{conversationId}` |
| `agent_send` | `conversationId, message, crossTask?: bool` (default false) | `{ok: true}` |
| `agent_interrupt` | `conversationId` | `{ok: true}` |
| `agent_observe` | `conversationId, waitForChange?: bool, timeoutMs?` | `{status, recentEvents, lastAssistantMessage?, providerTier, statusChangedAt}` |
| `agent_fetch` | `conversationId, kind: 'events'\|'scrollback'\|'transcript', limit?, since?` | `{items, nextCursor?, providerTier, transcriptSupported}` |
| `agent_close` | `conversationId` | `{ok: true}` |

### Reporting — 4 tools

| Tool | Params | Effect |
|---|---|---|
| `report_status` | `state, message` | drives ConversationStore status indicator |
| `report_tasks` | `tasks[]` snapshot | renders todo list in task sidebar (new section) |
| `notify` | `title, body, urgency?` | OS notification + bring-to-front |
| `request_input` | `prompt, timeoutMs?` | long-poll: blocks; UI shows prompt; returns user reply |

### Set B — start small, expand

v1 ships a curated subset:

```
project_list, project_get, project_archive, project_set_appearance, project_open
task_list, task_get, task_create, task_open, task_archive
conversation_list, conversation_open
view_layout_set, view_open_file
workspace_get_diff, workspace_list_files, workspace_dev_servers, workspace_create_pr
skills_list, mcp_list
settings_get
```

Total v1 tool count: **8 + 4 + 21 = 33**. Larger than ideal but resource-noun grouping keeps each tool single-purpose. Future v1.x adds the remaining items as user signal warrants.

---

## 7. Provider compatibility

| Provider | MCP config | Transcript file | Hooks | `agent_fetch(transcript)` works? |
|---|---|---|---|---|
| Claude Code | `~/.claude.json` | `~/.claude/projects/<enc>/<id>.jsonl` | yes (HTTP) | yes |
| Codex | `~/.codex/config.toml` | `~/.codex/sessions/<id>.jsonl` | partial | yes |
| Copilot CLI | `~/.copilot/mcp-config.json` | `~/.copilot/session-state/<id>/events.jsonl` + sqlite | `.github/hooks/*.json` | yes |
| Gemini | `~/.gemini/settings.json` | partial | unclear | partial |
| Cursor | `~/.cursor/mcp.json` | binary state | no | no |
| OpenCode | `~/opencode.json` | varies | no | no |
| Amp | `~/.config/amp/settings.json` | varies | no | no |
| Aider | none | none | none | n/a — Aider has no MCP client; emdash MCP not exposed there |

`agent_observe.providerTier`:
- `'hooks'` — full structured event stream + `lastAssistantMessage` (Claude / Codex / Copilot / Devin / Droid / Junie / Kimi)
- `'classifier'` — status transitions only, no assistant text (others)
- `'unsupported'` — Aider

Capturing the external session ID per provider:
- Claude Code: pass `--session-id <uuid>` flag at spawn (existing emdash flow already does this for resume).
- Codex: similar (resume support exists).
- Copilot CLI: watch `~/.copilot/session-state/` for new directory at spawn time (no `--session-id` flag); record the resulting ID on `Conversation.externalSessionId`.

Schema additions on `conversations`:
```
external_session_id TEXT
external_source_path TEXT
imported INTEGER NOT NULL DEFAULT 0
```

`agent_fetch(kind:'transcript')` looks up `external_session_id` + provider, dispatches to a per-provider transcript reader, returns paginated structured messages. No emdash DB persistence.

---

## 8. Subprocess binary (`src/mcp-server/`)

Single-entry MCP server using `@modelcontextprotocol/sdk` over stdio.

```
src/mcp-server/
├── index.ts              # entry — instantiate Server, register tools, connect StdioTransport
├── http-client.ts        # tiny fetch wrapper, adds auth headers from process.env
├── identity.ts           # reads + validates EMDASH_* env on boot
├── tools/
│   ├── agent.ts          # Set A tool registrations
│   ├── reporting.ts      # report_status, report_tasks, notify, request_input
│   ├── project.ts        # Set B project_*
│   ├── task.ts           # Set B task_*
│   ├── conversation.ts
│   ├── view.ts
│   ├── workspace.ts
│   ├── settings.ts
│   └── index.ts          # registerAllTools(server)
└── schemas/              # Zod schemas shared with main process via ../shared/mcp-tools.ts
```

Each tool is thin:
```ts
server.tool('agent_observe', AgentObserveSchema, async (params) => {
  const res = await http.get(`/agent/${params.conversationId}/observe`, params);
  return { content: [{ type: 'json', json: res }] };
});
```

electron-vite entry config (additive):
```ts
// electron.vite.config.ts
mcpServer: {
  root: 'src/mcp-server',
  build: {
    outDir: 'out/mcp-server',
    rollupOptions: { input: 'src/mcp-server/index.ts', output: { format: 'cjs', entryFileNames: 'index.cjs' } },
  },
}
```

At runtime emdash resolves the binary path via electron `process.resourcesPath` or dev path, hands it to the catalog entry on app boot.

---

## 9. Main-side module (`src/main/core/mcp-internal/`)

```
src/main/core/mcp-internal/
├── index.ts                    # exported singleton initializeMcpInternal()
├── http-server.ts              # Fastify or Node http; route registration
├── auth.ts                     # token validation, session lookup
├── catalog-refresh.ts          # rebuild canonical McpServer + saveServer on boot
├── instance.ts                 # generate INSTANCE_ID, allocate port
├── routes/
│   ├── agent.ts                # GET self, peers, observe, fetch — POST send/interrupt/spawn — DELETE close
│   ├── reporting.ts            # POST status/tasks/notify/request-input — broadcast to renderer via existing IPC channels
│   ├── project.ts              # delegates to existing controllers
│   ├── task.ts
│   ├── conversation.ts
│   ├── view.ts                 # IPC events to renderer (focus tab / change layout)
│   └── workspace.ts            # uses GitService, PrGenerationService, etc.
├── capabilities.ts             # capability bucket lookup per task
└── audit.ts                    # logs cross-task writes for visibility
```

Key wiring touchpoints in existing code:
- `src/main/core/conversations/operations/createConversation.ts` — set `EMDASH_*` env in PTY spawn options.
- App boot (existing init order): after `mcpService` is ready, call `initializeMcpInternal()` → starts HTTP server + refreshes catalog entry.
- `src/main/core/agent-hooks/hook-server.ts` — extend its in-memory event buffer to be queryable per-conversation (used by `agent_fetch(kind:'events')`).

---

## 10. Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| Two emdash instances run simultaneously | Each generates own `INSTANCE_ID` + port; HTTP server validates instance — cross-instance requests rejected (audit-logged) |
| Token leak (env var leak) | Token rotated per app launch. Worst case: one instance compromised until restart |
| MCP subprocess can't reach loopback | Tool returns `{error: 'unreachable'}`; agent retries; user sees notification with diagnostic |
| User uninstalls emdash from MCP page mid-session | Catalog refresh on next boot; running conversations lose tools but don't crash (server still serves them) |
| Provider's static `.mcp.json env` shadows per-conv vars | Catalog entry's `env` field deliberately omits per-conv keys; only INSTANCE_ID + STATUS_URL static |
| Conversation deleted while peer holds reference | All `/agent/{id}/*` routes return 410 Gone; calling agent should fall back |
| Cross-task `agent_send` abuse | Capability gate + audit log + UI badge on receiving conversation |
| Long-poll ties up requests | Default timeout 30 s, cap 60 s; server uses async I/O so doesn't block other routes |

---

## 11. Phasing

**PR1 — bootstrap (this branch):**
1. `src/mcp-server/` skeleton (electron-vite entry + 3 stub tools)
2. `src/main/core/mcp-internal/` HTTP server + auth + instance/port mgmt
3. `emdash` entry in `catalogData`
4. App boot: refresh emdash catalog entry
5. PTY env injection at conversation spawn
6. Implement: `agent_self`, `agent_observe`, `agent_send`, `report_status`
7. Manual test: install emdash MCP via UI in Claude Code, spawn conversation, verify agent_self returns correct identity

**PR2 — Set A complete:**
- `agent_list_peers`, `agent_spawn`, `agent_close`, `agent_interrupt`
- `agent_fetch(events|scrollback)` from in-memory buffers
- `report_tasks`, `notify`, `request_input`

**PR3 — Set A transcript reads:**
- Per-provider transcript readers (Claude / Codex / Copilot)
- `external_session_id` capture at spawn
- Schema migration for `conversations`
- `agent_fetch(transcript)` end-to-end

**PR4 — Set B core (read-only):**
- Project / task / conversation / workspace read tools
- Capability bucket scaffolding (default core-only enabled)
- View / UI ops (open file, switch layout)

**PR5 — Set B writes + capability UI:**
- Write tools behind `driving:write` toggle
- Per-task capability settings UI
- Audit log surfaced as task-view tab

**PR6 — Set B dangerous + cross-task writes:**
- Delete / settings / mcp_install behind `driving:dangerous`
- `agent_send(crossTask:true)` audit + UI badge

---

## 12. Open questions

1. Is `report_tasks` rendering distinct from existing emdash task list? Recommend: separate sidebar section in task view labeled "Agent plan", independent from emdash's own tasks.
2. `request_input` UI shape — modal or inline in task view? Lean inline with timeout countdown.
3. Capability defaults per provider — Claude / Codex / Copilot default-core-on; everyone else default-core-on too. No per-provider gating.
4. Audit log retention — keep last 1000 events in memory only (no DB)? Or persist to a JSONL in emdash data dir?
5. Should `agent_spawn` be allowed during high-cost states (e.g. parent agent currently `awaiting-input`)? Suggest yes — orchestration shouldn't be blocked by parent state.

---

## 13. Out-of-scope (for now)

- **Browser hosting of emdash MCP** — would need WebSocket transport. v2.
- **Recording / replaying conversations from emdash MCP traffic** — interesting for testing but separate feature.
- **Tool-level rate limiting** — assume in-process trust; revisit if abuse appears.
- **Per-conversation tool subsets** — task-level capabilities are enough granularity; per-conversation overrides not justified.

---

## 14. Glossary

- **Conversation** — one PTY session running one agent CLI inside emdash.
- **Task** — a worktree + a set of conversations operating on it.
- **Provider** — agent CLI brand (Claude Code, Codex, Copilot CLI…).
- **Tier** (`hooks|classifier|unsupported`) — how rich the event stream is for a given provider.
- **Capability bucket** — named set of tools the user has enabled for a task (`core`, `driving:write`, `driving:dangerous`, `cross-task:write`).
- **Instance** — a running emdash process. Identified by `EMDASH_INSTANCE_ID` (UUID, regenerated each launch).
