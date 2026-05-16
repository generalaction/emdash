# MCP

emdash interacts with the Model Context Protocol in two directions:

- **Outbound** — emdash configures MCP servers for the agents it spawns (Claude
  Code, Cursor, Codex). Documented under "Outbound" below.
- **Inbound** — emdash exposes its own MCP server so external agents can drive
  it. Documented under "Inbound" below.

## Outbound: emdash configuring agent MCP servers

### Main Files

- `src/main/core/mcp/services/McpService.ts`
- `src/main/core/mcp/utils/` — adapters, catalog, config IO, config paths, conversion
- `src/main/core/mcp/controller.ts`
- `src/shared/mcp/`
- `src/renderer/components/mcp/`
- `src/renderer/views/mcp-view.tsx`

### Current Behavior

- MCP server configs are read, adapted, merged, and written across supported agent ecosystems
- provider-specific config formats are handled through adapters in `src/main/core/mcp/utils/`
- the renderer MCP UI manages installed servers and catalog entries

### Important Constraint

- Codex currently supports stdio MCP servers only

### Rules

- do not assume all providers support the same MCP transport types
- keep canonical MCP data in shared types and adapt at the edges
- if you add provider-specific MCP behavior, update both service and UI compatibility handling

## Inbound: emdash as an MCP server

emdash also runs its own MCP server so external AI agents (Claude Code, Cursor,
Codex, etc.) can drive emdash from the outside — creating tasks, managing
projects, registering MCP servers and skills, and observing/writing to live
PTY sessions. This is the inverse of the outbound integration above. Full
design lives in `docs/superpowers/specs/2026-05-16-mcp-server-design.md`.

### Enabling

Settings → MCP Server → toggle on. Defaults:

- Bind: `127.0.0.1:7457` (loopback only).
- Auth: auto-generated bearer token persisted at `~/.emdash/mcp.json` with mode
  `0600`. Rotatable from Settings.
- Off by default; the toggle is stored in `appSettings.mcpServer.enabled`.

### Architecture

```
external MCP client (Claude Code, Cursor, Codex)
        │  stdio
        ▼
emdash-mcp                  (bin/emdash-mcp.ts — stdio bridge subprocess)
        │  HTTP + Authorization: Bearer <token>
        ▼
McpHttpServer               (127.0.0.1:<port>, loopback only)
        │
        ▼
McpServer                   (@modelcontextprotocol/sdk)
        │
        ▼
Existing operation functions  (createTask, addProject, …)
```

External clients spawn the standalone `emdash-mcp` stdio bridge; the bridge
reads `~/.emdash/mcp.json` and proxies JSON-RPC over loopback HTTP to the
in-process `McpHttpServer`. The HTTP server is loopback-only and enforces a
`Host`-header check to mitigate DNS rebinding.

### Main Files

- `src/main/core/mcp-server/service.ts` — singleton lifecycle (`IInitializable` / `IDisposable`); reconciles `appSettings.mcpServer.{enabled,port}`
- `src/main/core/mcp-server/http-server.ts` — loopback HTTP transport, bearer auth, Host-header check, per-session `StreamableHTTPServerTransport`
- `src/main/core/mcp-server/server.ts` — constructs the SDK `McpServer` and wires the tool + resource registries
- `src/main/core/mcp-server/token-store.ts` — read / write / rotate `~/.emdash/mcp.json` (mode 0600)
- `src/main/core/mcp-server/recent-calls.ts` — in-memory ring buffer of the last 200 tool invocations
- `src/main/core/mcp-server/controller.ts` — renderer-facing RPC controller (`getStatus`, `setEnabled`, `setPort`, `rotateToken`, `getRecentCalls`)
- `src/main/core/mcp-server/tools/` — `task-tools`, `project-tools`, `mcp-tools`, `skill-tools`, `worktree-tools`, `system-tools`
- `src/main/core/mcp-server/resources/` — `project-resource`, `task-resource`, `task-session-resource` (PTY) + `pty-mcp-adapter`
- `bin/emdash-mcp.ts` — standalone Node entrypoint that bridges stdio ↔ HTTP

### Tool catalog (summary)

One-line summary per group — see the design spec for the full per-tool reference.

- **Tasks** — create / list / get / update / delete / archive / unarchive / sendInput / getOutput / listSessions / openInIDE
- **Projects** — add / list / get / updateSettings / delete
- **MCP servers** (the outbound ones emdash configures for agents) — list / add / remove
- **Skills** — list / installFromCatalog / createCustom / uninstall
- **Worktrees** — openInIDE
- **System** — listEditors / health

### Resources

Resources let an MCP client subscribe to live state instead of polling.

- `emdash://projects` — all projects; subscribe for add/remove
- `emdash://projects/{id}/tasks` — tasks in a project; subscribe for create/update/archive/delete
- `emdash://tasks/{id}` — single-task detail; subscribe for status/PR/metadata changes
- `emdash://tasks/{id}/sessions/{sid}` — PTY session: `read` returns the current 64 KB ring-buffer snapshot + cursor, `subscribe` streams live output deltas
- `emdash://mcp-servers` — configured outbound MCP servers across providers; subscribe for config-file changes
- `emdash://skills` — installed + catalog skills; subscribe for install/uninstall

### Safety notes

- **Destructive tools require `confirm: true`** — `task.delete`, `project.delete`, `mcp.remove`, `skill.uninstall`. Without it the tool returns a structured "would delete X" error instead of touching state.
- **Loopback only** — `McpHttpServer` binds explicitly to `127.0.0.1`; never `0.0.0.0` or a public address.
- **Host-header check** — requests whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>` get HTTP 421. This mitigates browser-based DNS-rebinding attacks.
- **Token file permissions** — `~/.emdash/mcp.json` is written at mode `0600`; the service warns at startup if it has been clobbered to something more permissive.
- **Token rotation** — Settings → MCP Server → rotate token regenerates the bearer, rewrites the file, and restarts the HTTP server so active sessions reconnect with the new token.

### For agent authors using this MCP server

Configure your MCP client by copy-pasting the provider-specific snippet from
Settings → MCP Server → Connection (Claude Code, Cursor, Codex have different
config shapes — the UI emits the right one for each). The snippet points the
client at the `emdash-mcp` bridge binary; no manual token wiring is needed
because the bridge reads `~/.emdash/mcp.json` directly.

### Rules

- Don't add network listeners outside `127.0.0.1`; loopback-only is a security invariant.
- New tools belong in `src/main/core/mcp-server/tools/` and must be aggregated in `tools/index.ts`. Mark destructive tools as requiring `confirm: true`.
- New resources belong in `src/main/core/mcp-server/resources/` and must be aggregated in `resources/index.ts`.
- Tools call existing operation functions in-process — don't duplicate business logic; reuse the `Result<T, E>` shape.
- The same `McpServer` instance is shared across all HTTP sessions; transports are tracked per-session via `onsessioninitialized` (see `http-server.ts`).
