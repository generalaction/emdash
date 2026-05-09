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
- Cross-task talk allowed but discouraged via explicit flag + capability gate + UI badge on receive.
- Minimal tool count — fewer well-shaped tools over many narrow ones.

### Non-goals (v1)
- ACP transport — defer until industry standardizes (revisit when Zed pattern stabilizes).
- Emdash-internal message persistence DB — read transcripts on-demand from each provider's own files.
- Browser / web client — same trick can be done later, but v1 is for in-process agent CLIs only.
- Cross-emdash-instance talk — single instance only.
- UI-replacement tool surface (project / view / settings / skills / mcp driving). Deferred — see §13.
- Reporting tools (`report_*`) — deferred to v2 as part of classifier→agent-emit migration. See §6 / §13.

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

### Orchestration / awareness / terminals endpoints

```
# Tasks (orchestration only — no rename/archive/delete in v1)
GET    /tasks?projectId=&includeArchived=       task_list
POST   /tasks                                   task_create

# Workspace
GET    /workspace/dev-servers                   workspace_dev_servers

# Terminals (caller's task only)
GET    /terminals                               terminal_list
POST   /terminals/{terminalId}/send             terminal_send
POST   /terminals                               terminal_create
```

### Capability gating

Two buckets per task. Persisted on the task. UI surfaces toggles in task settings.

- `core` — Set A (excluding cross-task writes) + orchestration + workspace awareness + terminals. Always on.
- `cross-task:write` — `agent_send(crossTask:true)`, `agent_interrupt` cross-task, `task_create` for projects other than caller's. Default off.

Server checks capability bucket vs. caller's task on every request. Cross-task reads (`agent_list_peers(scope:'project'\|'all')`, `agent_observe`, `agent_fetch`) are core — visibility is cheap, writes are gated.

---

## 6. MCP tool surface (locked, 14 tools)

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

### Orchestration — 2

| Tool | Params | Effect |
|---|---|---|
| `task_create` | `projectId?, name, sourceBranch?, taskBranch?, initialPrompt?, providerId?` (projectId defaults to caller's project) | Creates a new task. Returns `{taskId, conversationId?}`. Use case: research agent kicks off parallel implementation task |
| `task_list` | `projectId?, includeArchived?` | Returns task summaries for orchestration decisions |

Other `task_*` and all `conversation_*` driving tools are deferred (see §13) — they duplicate existing UI and aren't worth the surface area for v1.

### Workspace awareness — 1

| Tool | Params | Effect |
|---|---|---|
| `workspace_dev_servers` | — | Lists running dev server URLs for the caller's task. Agents can't introspect this via shell. Useful for testing agents that need to curl a running server |

`workspace_get_diff`, `_list_files`, `_search`, `_commit`, `_run_lifecycle`, `_create_pr` deferred — agent CLIs already have `git`, `find`, `rg`, `gh`. `_create_pr` may be promoted to v1 if `PrGenerationService` performs AI body generation worth wrapping; verify before locking PR1.

### Terminals — 3

| Tool | Params | Effect |
|---|---|---|
| `terminal_list` | — | List terminals open in the caller's task: `[{terminalId, cwd, name, lastActivityAt}]` |
| `terminal_send` | `terminalId, text, submit?: bool` | Append `text` to terminal; if `submit=true`, also send `\n`. Lets agents drop commands the user runs without copy-paste |
| `terminal_create` | `initialCommand?, name?, focus?: bool` | Opens terminal drawer if closed, spawns a new terminal in the worktree. If `initialCommand` set, auto-types + submits. Returns `{terminalId}` |

Use case: agent says "run `pnpm test:auth` to verify" and calls `terminal_create({initialCommand: 'pnpm test:auth'})` — user sees it execute without copy-paste.

### Reporting — deferred to v2

The following four tools are deliberately NOT in v1:

- `report_status` — agent self-reports working/awaiting/done state
- `report_tasks` — agent declares its todo plan, rendered as native sidebar list
- `notify` — OS notification on completion
- `request_input` — agent pauses, native UI prompt with timeout

They are valuable long-term — they would let agents drive emdash's status pipeline directly, eventually **replacing** the classifier + hook system that currently infers state from PTY output. That's a bigger refactor than v1 should take on.

Today emdash already detects status from PTY (classifier wiring + hook server in `src/main/core/agent-hooks/`). Adding `report_*` tools alongside means two parallel systems writing the same state, with no clear winner. v2 commits to the migration: agents emit, classifiers retire.

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
```

Key wiring touchpoints in existing code:
- `src/main/core/conversations/operations/createConversation.ts` — set `EMDASH_*` env in PTY spawn options.
- App boot (existing init order): after `mcpService` is ready, call `initializeMcpInternal()` → starts HTTP server + refreshes catalog entry.
- `src/main/core/agent-hooks/hook-server.ts` — extend its in-memory event buffer to be queryable per-conversation (used by `agent_fetch(kind:'events')`).

---

## 10. Failure modes & mitigations

| Failure | Mitigation |
|---|---|
| Two emdash instances run simultaneously | Each generates own `INSTANCE_ID` + port; HTTP server validates instance — cross-instance requests rejected with 401 |
| Token leak (env var leak) | Token rotated per app launch. Worst case: one instance compromised until restart |
| MCP subprocess can't reach loopback | Tool returns `{error: 'unreachable'}`; agent retries; user sees notification with diagnostic |
| User uninstalls emdash from MCP page mid-session | Catalog refresh on next boot; running conversations lose tools but don't crash (server still serves them) |
| Provider's static `.mcp.json env` shadows per-conv vars | Catalog entry's `env` field deliberately omits per-conv keys; only INSTANCE_ID + STATUS_URL static |
| Conversation deleted while peer holds reference | All `/agent/{id}/*` routes return 410 Gone; calling agent should fall back |
| Cross-task `agent_send` abuse | Capability gate (off by default) + UI badge on receiving conversation's tab on next message |
| Long-poll ties up requests | Default timeout 30 s, cap 60 s; server uses async I/O so doesn't block other routes |

---

## 11. Phasing

**PR1 — bootstrap (this branch):**
1. `src/mcp-server/` skeleton (electron-vite entry + stdio MCP boilerplate)
2. `src/main/core/mcp-internal/` HTTP server + auth + instance / port mgmt
3. `emdash` entry in `catalogData`
4. App boot: refresh emdash catalog entry with current port / instance
5. PTY env injection at conversation spawn
6. Implement: `agent_self`, `agent_observe`, `agent_send`
7. Manual test: install emdash MCP via UI in Claude Code, spawn conversation, verify `agent_self` returns correct identity, two conversations talk via `agent_send` + `agent_observe`

**PR2 — Set A complete:**
- `agent_list_peers`, `agent_spawn`, `agent_close`, `agent_interrupt`
- `agent_fetch(events|scrollback)` from in-memory buffers
- Cross-task scope query support + `cross-task:write` capability bucket

**PR3 — transcript reads:**
- Per-provider transcript readers (Claude Code, Codex, Copilot CLI)
- `external_session_id` capture at conversation spawn
- Schema migration adding `external_session_id` / `imported` / `external_source_path` to conversations
- `agent_fetch(transcript)` end-to-end

**PR4 — orchestration + awareness + terminals:**
- `task_list`, `task_create`
- `workspace_dev_servers`
- `terminal_list`, `terminal_send`, `terminal_create`
- Capability toggle UI in task settings panel

---

## 12. Decisions log

- **`agent_spawn` while parent is `awaiting-input`**: allowed. MCP is stateless; orchestration doesn't depend on parent state.
- **`terminal_send` consent prompt**: not added. Tool is core, no extra friction. User already opts in by installing the emdash MCP server.
- **`workspace_create_pr`**: dropped from v1 (no AI body generation in `pull-requests/` module — agents use `gh pr create` directly). Stays in deferred §13.
- **Audit log**: not in scope. Cross-task signal = capability gate + UI badge on receive.

---

## 13. Deferred — v2 roadmap

These are intentionally NOT in v1, with a path to v2.

### Reporting tools (replace classifier system)

| Tool | Purpose |
|---|---|
| `report_status` | Agent self-reports working/awaiting/done — drives ConversationStore status indicator |
| `report_tasks` | Agent declares todo plan, rendered as native sidebar list ("Agent plan") |
| `notify` | OS notification + bring-to-front |
| `request_input` | Long-poll: blocks; UI shows prompt with timeout countdown; returns user reply |

**Why deferred**: emdash currently infers state from PTY (classifier wiring + hook server in `src/main/core/agent-hooks/`). Adding `report_*` tools means two parallel writers to the same state. v2 commits to migrating: agents emit, classifiers retire. Bigger refactor than v1 should take on.

### Set B driving (UI replacement)

Tools that duplicate emdash UI. Skipped in v1 because the UI already does the job.

| Group | Tools |
|---|---|
| Projects | `project_list` `project_get` `project_create_local` `project_create_clone` `project_archive` / `_unarchive` `project_set_appearance` `project_open` `project_delete` |
| Tasks (CRUD beyond orchestration) | `task_get` `task_rename` `task_pin` `task_archive` / `_unarchive` `task_open` `task_delete` |
| Conversations | `conversation_list` `conversation_create` `conversation_rename` `conversation_delete` `conversation_open` |
| View / UI | `view_layout_set` `view_open_file` `view_open_diff` `view_terminal_open` / `_close` `view_sidebar_set` |
| Workspace inspection | `workspace_get_diff` `workspace_list_files` `workspace_search` `workspace_list_open_prs` `workspace_run_lifecycle` `workspace_commit` |
| Workspace mutate | `workspace_create_pr` — agents currently use `gh pr create`. Promote when emdash adds AI body generation worth wrapping |
| Settings / extensions | `skills_list` `skills_install` `mcp_list` `mcp_install` `mcp_remove` `settings_get` `settings_set` |

Promoted to v1 individually if a clear "agent CLI cannot do this with shell tools" justification emerges.

### Other out-of-scope

- **Browser hosting of emdash MCP** — would need WebSocket transport. Possibly v3.
- **Recording / replaying conversations from emdash MCP traffic** — separate feature.
- **Tool-level rate limiting** — assume in-process trust; revisit if abuse appears.
- **Per-conversation tool subsets** — task-level capabilities sufficient.
- **ACP transport** — defer until industry standardizes on Zed's ACP. Migration is renderer/main boundary swap, not user-facing.

---

## 14. Glossary

- **Conversation** — one PTY session running one agent CLI inside emdash.
- **Task** — a worktree + a set of conversations operating on it.
- **Provider** — agent CLI brand (Claude Code, Codex, Copilot CLI…).
- **Tier** (`hooks|classifier|unsupported`) — how rich the event stream is for a given provider.
- **Capability bucket** — named set of tools the user has enabled for a task. v1 has `core` (always on) and `cross-task:write` (off by default).
- **Instance** — a running emdash process. Identified by `EMDASH_INSTANCE_ID` (UUID, regenerated each launch).
