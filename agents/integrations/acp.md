# ACP (Agent Client Protocol)

ACP is the structured-chat runtime path (as opposed to the legacy PTY/TUI path). Only
providers that declare `acp: { kind: 'supported' }` use it — currently Claude and Codex.

## Layers

1. **Capability contract** — `packages/core/src/agents/plugins/capabilities/acp.ts`
   - `AcpSpawnContext`, `AcpSpawnResult`, `AcpProcessIo`, `AcpAgentApi`, `AcpClientFactory`
   - `IAcpBehavior { buildSpawn(ctx), connect(io, toClient), enrich?(update, raw) }`
   - `acpCapability` — Zod union `{ kind: 'none' } | { kind: 'supported' }`, default `none`

2. **Provider behavior** — `packages/plugins/src/agents/impl/<provider>/index.ts`
   - `claude/index.ts` — spawns the Claude ACP adapter
     (`@agentclientprotocol/claude-agent-acp`) as a Node child process; `connect` wraps
     stdio via `ClientSideConnection`/`ndJsonStream`; `enrich: enrichClaudeUpdate` promotes
     vendor `_meta.claudeCode.parentToolUseId` into first-class fields
   - `codex/index.ts` — same pattern using `@agentclientprotocol/codex-acp`

3. **Session runtime (protocol/state machine)** — `packages/core/src/acp/`
   - `acp-session-runtime.ts` — `AcpSessionRuntime` (`IAcpSessionRuntime`): session
     lifecycle, turns, permissions, terminals, modes, config options
   - `acp-agent-connection.ts` — connection-level wiring

4. **Desktop adapter** — `src/main/core/acp/`
   - `acp-session-manager.ts` — `AcpSessionManager`, one runtime per machine; resolves
     plugin behavior via `getPlugin(providerId).behavior.acp`
   - `production-acp-session-manager.ts` — production singleton wiring
   - `controller.ts` — RPC surface (`prompt`, `cancel`, `setModel`, `setMode`,
     `setConfigOption`, `getChatHistory`, `getSessionState`, `resolvePermission`,
     `getTerminals`)
   - `transport/` — process hosting: `local-acp-process-host.ts` (local `child_process`),
     `legacy-ssh-acp-process-host.ts` (remote/SSH-hosted), `acp-process-host-manager.ts`

5. **Shared types** — `src/shared/core/acp/` (`acpPermissions.ts`, `acpTurns.ts`,
   `acpEvents.ts`)

6. **Renderer** — `src/renderer/features/tasks/acp/` maps ACP updates into `@emdash/chat-ui`

## Rules

- keep protocol/state-machine behavior in `packages/core/src/acp/`
- keep provider-specific spawn/connect/enrich transforms in
  `packages/plugins/src/agents/impl/`
- adapt UI payloads only at the app (`src/main/core/acp/`) or chat-UI edges
- treat ACP process spawning as security-sensitive (see root `AGENTS.md` Agent Guardrails)
