# MCP

Emdash is on both sides of MCP: it manages the MCP servers that agents connect to, and
it exposes one of its own so agents can drive Emdash tasks.

## Managing agent MCP servers

Main files:

- `packages/core/src/primitives/mcp/api/` — canonical `McpServer` schema and the
  conversions to and from the plugin registration shape
- `packages/core/src/runtimes/agent-config/node/runtime/mcp.ts` — `AgentMcpConfigManager`
  reads, merges, and writes each provider's config files under a write lock
- `apps/emdash-desktop/src/core/features/mcp/api/` — wire contract and browser client
- `apps/emdash-desktop/src/core/features/mcp/node/wire-controller.ts` — desktop controller
- `apps/emdash-desktop/src/core/features/mcp/browser/` — `McpView`, list, cards, drawer
- `apps/emdash-desktop/src/core/primitives/mcp/api/catalog.ts` — the catalog offered in the UI

Behavior:

- MCP server configs are read, adapted, merged, and written per provider ecosystem;
  provider-specific formats are handled through the plugin registration conversions
- the config lives on the host that owns the agent, so all of this goes through the
  runtime broker (`runtimes.client(host).agentConfig`) rather than local fs calls
- the MCP settings page manages installed servers and catalog entries

Rules:

- do not assume all providers support the same MCP transport types
- keep canonical MCP data in shared types and adapt at the edges
- if you add provider-specific MCP behavior, update both the runtime and UI compatibility
  handling

## Emdash's own MCP server

Main files:

- `apps/emdash-desktop/src/core/features/mcp/node/server/create-mcp-server.ts` — composition
  root; returns the handle used by bootstrap and the wire controller
- `.../server/mcp-http-server.ts` — the HTTP listener, token file, and origin checks
- `.../server/register-tools.ts` — tool definitions
- `.../server/create-task-from-prompt.ts`, `resolve-from-branch.ts`, `run-task-script.ts`,
  `attach-project.ts` — tool implementations and their helpers
- `.../server/self-registration.ts` — builds and heals the `emdash` entry in agent configs
- `apps/emdash-desktop/src/core/primitives/mcp/api/managed.ts` — the shape rules that
  identify the managed entry
- `apps/emdash-desktop/src/main/bootstrap/boot/phases/services.ts` and
  `phases/background.ts` — construction and startup
- `apps/emdash-desktop/src/main/bootstrap/boot/mcp-initial-conversation.ts` — the adapter
  that starts a PTY or ACP session for a task the server just created

Behavior:

- a streamable-HTTP MCP server listens on `127.0.0.1:8212/mcp`, started in the background
  phase of boot
- every request needs `Authorization: Bearer <token>`; the token is generated on first
  start and persisted `0o600` at `<userData>/mcp-token`
- requests are also rejected unless `Host` and `Origin` are loopback, guarding against
  DNS rebinding from a browser
- the transport runs stateless (`sessionIdGenerator: undefined`, JSON responses), so a
  fresh `McpServer` is built per request
- tools: `list_projects`, `list_tasks`, `create_task`, `rename_task`, `archive_task`,
  `delete_task`, `run_task_script`, `stop_task_script`
- `delete_task` refuses a dirty worktree unless the caller passes `confirm: true`, which
  the agent is expected to obtain from the user
- tool errors are summarized for the caller and logged in full; internal messages
  (paths, SQL, host errors) must not reach the MCP client
- the server is headless, so it opens a project attachment itself via
  `withProjectAttachment`. A task session started under only that lease would be torn
  down when the lease is released, so `create_task` starts an agent only when the app
  already holds the project open, and otherwise returns a warning saying so.

Env vars:

- `EMDASH_MCP_SERVER=false` — do not start the listener at all
- `EMDASH_MCP_PORT` — bind a different port

### The managed catalog entry

The catalog's first entry is Emdash itself, marked `managed: true`. Managed entries have
no user-editable connection details: the drawer only asks which agents to sync to, and
the node side fills in the URL and bearer token on save (`resolveSelfServer`). On every
start, `refreshSelfServerRegistration` rewrites an existing registration whose URL or
token has drifted, but never creates one the user did not add.

Rules:

- "managed" is derived from shape, never from a renderer flag: name `emdash`, local host,
  http transport, and an empty or loopback `/mcp` URL (`isSelfServerEntry`). A user's own
  server that happens to be named `emdash` must pass through untouched.
- the entry is hidden for remote hosts, since the listener is on the desktop's loopback
  interface
- do not log or persist the token anywhere but its own file
