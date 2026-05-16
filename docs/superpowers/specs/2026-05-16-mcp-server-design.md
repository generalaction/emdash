# emdash MCP Server — Design Spec

**Date:** 2026-05-16
**Status:** Approved (foundational decisions confirmed via brainstorming)
**Owner:** Lord Niklas Flaig

## Goal

Expose emdash as a Model Context Protocol (MCP) server so external AI agents
(Claude Code, Cursor, Codex, etc.) can drive emdash from the outside: create
tasks, manage projects, register MCP servers and skills, observe and write to
running agent sessions, and open worktrees in IDEs.

This is the inverse of emdash's existing MCP integration, which configures
*outbound* MCP servers for the agents emdash spawns. Here, emdash itself is
the server.

## Foundational decisions (locked)

| Question | Decision |
|---|---|
| Transport | **stdio bridge → in-process HTTP**. External clients spawn `emdash-mcp` (stdio); the bridge proxies to a local HTTP MCP server inside the Electron main process. |
| Lifecycle / discovery | **Always on at fixed port + bearer token**, gated by a user-controlled toggle stored in `appSettings`. Defaults to **off**. |
| Auth | **Auto-generated bearer token**, persisted to `~/.emdash/mcp.json` at mode `0600`. Rotatable from Settings. |
| PTY interaction | **MCP resources + tools, with subscriptions.** Each PTY session is a resource; `task.sendInput` writes input. |
| Destructive ops | **Require explicit `confirm: true` argument.** Without it, tools return a structured "would delete X" error. |
| Skill add | **Both** `skill.installFromCatalog` (catalog) and `skill.createCustom` (new local skill). |
| Settings UI | **New "MCP Server" section in Settings** with toggle, connection info, token controls, recent calls. |
| Internal architecture | **Approach A:** new `core/mcp-server/` module with hand-curated tools that call existing operation functions in-process. |

## Architecture

A new domain module `src/main/core/mcp-server/` follows emdash's existing
service/controller pattern (`agents/conventions/main-patterns.md`).

```
external MCP client (Claude Code, Cursor, Codex)
        │  stdio
        ▼
emdash-mcp  (bin/emdash-mcp.ts — stdio bridge subprocess)
        │  HTTP + Authorization: Bearer <token>
        ▼
McpHttpServer (127.0.0.1:7457, loopback only)
        │
        ▼
McpServer (@modelcontextprotocol/sdk) ── Tool registry
                                       └─ Resource registry
        │
        ▼
Existing operation functions (createTask, addProject, …)
        │
        ▼
SQLite • PTY registry • Workspace registry • Event bus
```

### Module layout

```
src/main/core/mcp-server/
├── service.ts                 McpServerService singleton (IInitializable, IDisposable)
├── http-server.ts             Loopback HTTP transport, Host-header check, bearer auth
├── server.ts                  Wires @modelcontextprotocol/sdk Server, mounts tools + resources
├── controller.ts              RPC controller for the renderer Settings page
├── token-store.ts             Reads/writes ~/.emdash/mcp.json with mode 0600
├── recent-calls.ts            Ring buffer of recent tool invocations (last 200)
├── tools/
│   ├── index.ts               Aggregates tool registrations
│   ├── task-tools.ts
│   ├── project-tools.ts
│   ├── mcp-tools.ts
│   ├── skill-tools.ts
│   ├── worktree-tools.ts
│   └── system-tools.ts
└── resources/
    ├── index.ts
    ├── project-resource.ts
    ├── task-resource.ts
    └── task-session-resource.ts   PTY ring buffer + subscriptions

bin/
└── emdash-mcp.ts              Standalone Node entrypoint — stdio ↔ HTTP bridge

src/renderer/views/settings/mcp-server/   New Settings view
```

Tools call into existing operation functions (e.g.
`src/main/core/tasks/operations/createTask.ts`) **directly, in-process**. No
IPC round-trip; no duplicated business logic.

## Tool catalog (v1)

Each tool returns the same `Result<T, E>` shape as the underlying op.
Destructive tools require `confirm: true`.

### Tasks

| Tool | Description (LLM-facing summary) | Key args |
|---|---|---|
| `task.create` | Create a new task in a project; provisions a worktree and PTY by default. | `projectId`, `name`, `sourceBranch?`, `taskBranch?`, `strategy?`, `provision?` |
| `task.list` | List tasks in a project, filtered by status / archived state. | `projectId`, `status?`, `includeArchived?` |
| `task.get` | Full task detail incl. workspace info, PR list, conversation counts. | `taskId` |
| `task.update` | Edit name, status, source branch, linked issue, pin state. | `taskId`, `patch` |
| `task.delete` | Hard delete after teardown. **Requires `confirm: true`.** | `taskId`, `confirm` |
| `task.archive` / `task.unarchive` | Soft delete / restore. | `taskId` |
| `task.sendInput` | Write a string (with optional trailing CR) to a running PTY session. | `taskId`, `sessionId`, `data`, `appendEnter?` |
| `task.getOutput` | Read PTY ring buffer; supports `sinceCursor` for incremental reads. | `taskId`, `sessionId`, `sinceCursor?`, `bytes?` |
| `task.listSessions` | List PTY sessions and their status (running, exited, exit code). | `taskId` |
| `task.openInIDE` | Open task's worktree in a configured editor. | `taskId`, `editor` (`vscode`, `cursor`, `zed`, `sublime`, `terminal`) |

### Projects

| Tool | Description | Key args |
|---|---|---|
| `project.add` | Add a local project (Git repo path) or a remote project (SSH connection). | `path` or `{sshConnectionId, remotePath}`, `name?`, `baseRef?` |
| `project.list` | List all projects. | — |
| `project.get` | Project detail incl. settings, remotes, branches. | `projectId` |
| `project.updateSettings` | Patch base/shareable settings (worktreeDirectory, baseRemote, scripts, tmux, …). | `projectId`, `patch` |
| `project.delete` | Remove project from emdash (does not touch the on-disk repo). **Requires `confirm: true`.** | `projectId`, `confirm` |

### MCP servers (the outbound ones emdash configures for agents)

| Tool | Description | Key args |
|---|---|---|
| `mcp.list` | List configured MCP servers across providers. | `provider?` |
| `mcp.add` | Add or update an MCP server entry for one or more providers. | `name`, `transport`, `command?`, `args?`, `url?`, `headers?`, `env?`, `providers` |
| `mcp.remove` | Remove an MCP server entry. **Requires `confirm: true`.** | `name`, `providers?`, `confirm` |

### Skills

| Tool | Description | Key args |
|---|---|---|
| `skill.list` | List catalog and installed skills. | `installedOnly?` |
| `skill.installFromCatalog` | Install a skill from the catalog (anthropic / openai / local). | `skillId` |
| `skill.createCustom` | Create a brand-new local skill (writes a new SKILL.md). | `name`, `description`, `content` |
| `skill.uninstall` | Remove an installed skill. **Requires `confirm: true`.** | `skillId`, `confirm` |

### Worktrees & system

| Tool | Description | Key args |
|---|---|---|
| `worktree.openInIDE` | Open a workspace path in an editor (lower-level than `task.openInIDE`). | `workspaceId`, `editor` |
| `system.listEditors` | Detected IDE/editor binaries on this machine. | — |
| `system.health` | Server version, uptime, app version, recent-error count. | — |

## Resources

Resources let an MCP client subscribe to live state instead of polling.

| URI | Reads | Subscribes |
|---|---|---|
| `emdash://projects` | All projects | Add / remove |
| `emdash://projects/{id}/tasks` | Tasks in a project | Create / update / archive / delete |
| `emdash://tasks/{id}` | Single-task detail | Status / PR / metadata changes |
| `emdash://tasks/{id}/sessions/{sid}` | Current ring-buffer snapshot + cursor | Live output deltas |
| `emdash://mcp-servers` | Configured MCP servers across providers | Config-file changes |
| `emdash://skills` | Installed + catalog skills | Install / uninstall |

The PTY session resource is the centerpiece of "look into task." A client
`read` returns the same 64 KB ring buffer the renderer uses; `subscribe`
streams `update` notifications with deltas. Backed by a new `PtyMcpAdapter`
that wraps the existing `pty-session-registry` event stream.

## Auth, lifecycle, settings

- **Token storage:** On first start, generate `crypto.randomBytes(32).toString('base64url')`. Persist `{ port, token, version }` in `~/.emdash/mcp.json` at mode `0600`. The stdio bridge reads this file. HTTP clients send `Authorization: Bearer <token>`.
- **Enable toggle:** New `appSettings` key `mcpServer.enabled` (default `false`). Service reacts to changes — flipping on starts the HTTP server, flipping off shuts it down cleanly.
- **Port:** Configurable in settings; default `7457`. If port is in use, server publishes a structured error visible in the Settings UI.
- **Rotate token:** Settings button regenerates token, rewrites `mcp.json`, terminates active sessions so they reconnect with the new token.
- **Recent calls ring buffer:** In-memory only; last 200 calls (tool name, ms, status, error?). Surfaced in Settings.
- **Bind:** `127.0.0.1` only. Reject requests whose `Host` header isn't `127.0.0.1:<port>` or `localhost:<port>` to mitigate DNS rebinding.

## Settings UI (renderer)

New Settings view registered in `src/renderer/core/view/registry.ts`.

1. **Status:** Enabled toggle, "Running on `127.0.0.1:7457`" indicator, uptime.
2. **Connection:** Token field with reveal/copy/rotate; copy-paste config snippets for Claude Code, Cursor, Codex.
3. **Recent calls:** Live-updating list (tool name, ms, status). Backed by `mcpServer.getRecentCalls` + an event channel.
4. **Advanced:** Port input, "Open `mcp.json`" button.

Backed by a new `mcpServerController` exposing `getStatus`, `setEnabled`, `setPort`, `rotateToken`, `getRecentCalls`. The view subscribes to a new event channel for live status / recent-call updates.

## Data flow examples

### Create-and-watch a task (Claude Code over stdio)

1. Claude Code spawns `emdash-mcp` (stdio).
2. Bridge reads `~/.emdash/mcp.json`, opens HTTP MCP session against the running app.
3. Claude calls `task.create { projectId, name, provision: true }` → in-process `createTask` op → returns `{ taskId, sessions: [{id, ...}] }`.
4. Claude `subscribe`s to `emdash://tasks/<id>/sessions/<sid>`, gets initial ring-buffer snapshot + live updates.
5. Claude calls `task.sendInput { taskId, sessionId, data: "ls\n" }` to drive the agent.

### Edit project settings

1. `project.updateSettings { projectId, patch: { worktreeDirectory: "..." } }` → existing `updateProjectSettings` op → emits the existing `projectChanged` event → renderer auto-refreshes via React Query, identical to manual edits.

## Error handling

- Tool handlers translate `Result<T, E>` into MCP responses:
  - `Ok` → `{ content: [{ type: 'text', text: JSON.stringify(data) }] }`.
  - `Err` → `isError: true`; `content` carries `{ code, message, details? }`.
- Auth failure: HTTP `401`. Missing `confirm` on a destructive tool returns a structured error listing what would be deleted.
- Server-level: missing project / task ID → `code: 'NOT_FOUND'`. Workspace ref-counting conflict → `code: 'WORKSPACE_BUSY'`.
- Bridge translates HTTP 5xx into MCP transport errors so clients reconnect.

## Testing

- **Unit:** Each tool handler tested in isolation against an in-memory DB using existing `task-manager` fixtures (`vitest`).
- **Integration:** Spin the HTTP server on an ephemeral port, drive it with `@modelcontextprotocol/sdk`'s test client. Cover token auth, `confirm` enforcement, PTY subscribe with live writes, workspace ref-counting on `task.delete`.
- **Bridge:** Smoke test — spawn `emdash-mcp` against a stub HTTP server, verify stdio framing.
- **CI gates:** `pnpm run format`, `pnpm run lint`, `pnpm run typecheck`, `pnpm test`.

## Risks & follow-ups (not blocking v1)

- **Late subscribers miss early PTY output beyond 64 KB.** Acceptable for v1 — same limitation the renderer has. Future: opt-in larger buffer per session.
- **Concurrent `task.delete` while a session is being written to** — covered by existing workspace ref-counting; new tool surfaces the busy state via `WORKSPACE_BUSY`.
- **Token leakage if `~/.emdash/mcp.json` permissions get clobbered.** Service re-checks mode on startup and refuses to expose token if world-readable; logs a warning.
- **No multi-user / per-client tokens in v1** — tracked for v2; Settings UI leaves room for it.
- **No telemetry on MCP usage in v1.** If `TELEMETRY_ENABLED` is set, opt-in event for `mcpServer.toolCalled` (tool name only, no args) is a follow-up.

## Out of scope (explicit)

- Exposing emdash MCP over the network (non-loopback). Loopback only.
- Per-tool ACLs / scopes. v1 trusts the bearer token holistically.
- Browser-based MCP clients. We actively block them via Host-header check.
- Auto-config injection into Claude Code / Cursor settings. Settings UI shows copy-paste snippets; user pastes them.
