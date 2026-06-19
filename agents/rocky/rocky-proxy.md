# Rocky Proxy Integration

Rocky Proxy is the AI engine for Rocky. It lives in a **sibling repository** (not in
this codebase). This document describes the integration contract from Rocky's side —
what Rocky needs to provide Rocky Proxy and what Rocky Proxy emits back.

**When the Rocky Proxy API spec is available from the sibling repo, link it here and
reconcile any gaps with this document.**

---

## Why the Engine Swap

Today emdash spawns CLI agents (e.g. `claude`) inside a PTY and renders their terminal
output through xterm.js. Rocky replaces this with Rocky Proxy because:

- PTY output is unstructured text; Rocky needs typed events (approval cards, plan steps,
  usage meters)
- Every provider has different CLI flags; Rocky Proxy normalises to one session API
- Auth and credentials are handled by Rocky Proxy; Rocky never stores raw tokens
- Tool approvals, connectors (MCP), skills, and conversation history are first-class in
  Rocky Proxy's event stream

The swap is invisible to users — same or better UX, no regression in parallel agents or
notifications.

---

## Integration Point in the Codebase

Create `src/main/core/rocky-proxy/` with:

```
src/main/core/rocky-proxy/
├── controller.ts           — RPC handlers (startSession, sendMessage, stopSession, etc.)
├── rocky-proxy-service.ts  — Session lifecycle, event forwarding to renderer
├── rocky-proxy-client.ts   — HTTP/WebSocket client to the Rocky Proxy process/server
└── session-registry.ts     — Tracks active Rocky Proxy sessions by conversation ID
```

Register the controller in `src/main/rpc.ts`:

```ts
import { rockyProxyController } from './core/rocky-proxy/controller';

export const rpcRouter = createRPCRouter({
  // existing controllers ...
  rockyProxy: rockyProxyController,
});
```

Add shared types at `src/shared/core/rocky-proxy/`:

```
src/shared/core/rocky-proxy/
├── types.ts        — RockyProxySession, RockyProxyEvent, all event payload types
├── events.ts       — Typed event channels (rockyProxyEventChannel, etc.)
└── index.ts        — Re-exports
```

---

## Rocky Proxy Event Contract

Rocky Proxy emits a stream of typed events per session. Rocky renders each event as a
card or state update in the chat panel.

**Known event types (from PRD; reconcile with actual spec when available):**

| Event type | Payload | Rocky renders as |
|---|---|---|
| `text` | `{ content: string; role: 'assistant' \| 'user' }` | Text message bubble |
| `thinking` | `{ content: string }` | Collapsible "thinking" card (dimmed) |
| `tool_call` | `{ toolName: string; input: Record<string, unknown>; requiresApproval: boolean }` | Inline action-approval card if `requiresApproval`, else tool-activity card |
| `tool_result` | `{ toolName: string; output: unknown; approved: boolean }` | Completed action card in stream |
| `plan` | `{ steps: Array<{ id: string; label: string; status: 'pending' \| 'active' \| 'done' \| 'failed' }> }` | Plan/to-do panel (replaces current task steps) |
| `plan_step_update` | `{ stepId: string; status: PlanStep['status'] }` | Update a plan step checkbox |
| `artifact` | `{ id: string; type: ArtifactType; content: string; title: string; version: number }` | Opens / updates the Artifact Panel |
| `artifact_update` | `{ id: string; content: string; version: number }` | Replaces artifact content, creates new version |
| `usage` | `{ inputTokens: number; outputTokens: number; cost?: number; contextPercent: number }` | Updates context gauge and usage meter |
| `context` | `{ used: number; max: number; breakdown: Array<{ label: string; tokens: number }> }` | Context gauge click-through detail |
| `error` | `{ code: string; message: string; retryable: boolean }` | Error card in stream |
| `done` | `{ sessionId: string }` | Marks session complete; triggers notification if backgrounded |
| `approval_request` | `{ requestId: string; toolName: string; description: string; detail: Record<string, unknown> }` | Inline action-approval card with Approve / Deny / Edit |

**Session lifecycle RPC (Rocky → Rocky Proxy):**

```ts
// Start a new session
rockyProxy.startSession({
  conversationId: string;
  workspaceId: string;
  model: string;
  mode: 'ask' | 'agent' | 'plan';
  connectors: string[];      // enabled MCP server IDs for this session
  skills: string[];          // active skill IDs
  context: ContextAttachment[]; // @-mentioned items
  initialMessage: string;
}): Promise<{ sessionId: string }>

// Send a follow-up message
rockyProxy.sendMessage({
  sessionId: string;
  content: string;
  context?: ContextAttachment[];
}): Promise<void>

// Respond to an approval request
rockyProxy.respondToApproval({
  sessionId: string;
  requestId: string;
  decision: 'approve' | 'deny';
  editedInput?: Record<string, unknown>; // if user edited the action before approving
}): Promise<void>

// Stop a running session
rockyProxy.stopSession({ sessionId: string }): Promise<void>

// Switch model mid-conversation
rockyProxy.setModel({ sessionId: string; model: string }): Promise<void>
```

---

## Permissions Gate

Before forwarding a `tool_call` approval request to the renderer, check the permissions
service (`src/main/core/permissions/`) to see if the tool is on the auto-run allowlist:

```ts
const policy = await permissionsService.getPolicyForTool(toolName, workspaceId);

if (policy === 'auto_run') {
  await rockyProxyClient.respondToApproval({ requestId, decision: 'approve' });
  // emit a tool_result synthetic event to the renderer so the card still appears
} else {
  // forward approval_request event to renderer; wait for user decision
}
```

Safe default:
- Reads and searches → `auto_run` by default
- Anything that writes externally (email send, CRM write, calendar create) → `ask` by default

---

## Connection Transport

Rocky Proxy may expose a local HTTP server or a WebSocket stream — the exact transport
is defined in the sibling repo. The client in `src/main/core/rocky-proxy/rocky-proxy-client.ts`
abstracts the transport; the rest of the main process never calls the transport directly.

**Placeholder until sibling repo spec is available:**
- Assume a local HTTP server at a port determined at startup (passed to Rocky Proxy as
  a flag or environment variable, or discovered via IPC)
- Events stream via Server-Sent Events (SSE) or WebSocket from `GET /sessions/:id/stream`
- Commands sent via `POST /sessions/:id/messages` etc.

---

## Renderer-Side Rendering

The renderer subscribes to `rockyProxyEventChannel` (a typed event channel in
`src/shared/core/rocky-proxy/events.ts`) and renders each event:

- Add `useRockyProxyEvents(sessionId)` hook in `src/renderer/features/tasks/conversations/`
- Replace the current PTY rendering (`use-pty.ts` / `pty-pane.tsx`) in the conversation
  view with this hook
- Each event type maps to a React component in `src/renderer/features/tasks/conversations/`:
  - `TextMessageCard`
  - `ThinkingCard`
  - `ActionApprovalCard` (for `approval_request` / `tool_call` with `requiresApproval`)
  - `ActionResultCard` (for `tool_result`)
  - `PlanPanel` (for `plan` / `plan_step_update`)
  - `ArtifactTrigger` (for `artifact` — fires open/update in the Artifact Panel)
  - `ErrorCard`
  - `UsageIndicator` (updates the header gauge)

---

## Auth and Sign-in

Rocky Proxy handles provider auth. Rocky shows a "Connect your AI" screen during
onboarding that calls Rocky Proxy's auth flow (browser or device-code). Rocky never
stores raw API keys. See `src/main/core/account/` for the existing credential store
pattern — Rocky Proxy may vend a token or session cookie that goes into Electron safe
storage via the same pattern.

---

## What to Build First (Phase 0)

1. Stand up `src/main/core/rocky-proxy/rocky-proxy-client.ts` with a stub transport
   (returns mock events for development)
2. Build `rocky-proxy-service.ts` that forwards events to renderer via the typed event
   system in `src/main/lib/events.ts`
3. Build the renderer event hook `useRockyProxyEvents`
4. Replace the PTY terminal pane in one conversation with structured event card rendering
5. Connect the real Rocky Proxy transport once the sibling repo URL/protocol is confirmed

---

## Notes

- The existing PTY and CLI agent infrastructure (`src/main/core/pty/`,
  `src/shared/agent-provider-registry.ts`) is not deleted. It may still be used for
  developer mode or future non-Rocky-Proxy providers. It is simply not the path that
  Rocky's chat UI takes.
- Parallel sessions: Rocky Proxy must support multiple concurrent sessions. The
  `session-registry.ts` maps `conversationId → Rocky Proxy sessionId` and the existing
  multi-agent notification architecture in `src/main/core/agent-hooks/` continues to
  drive OS notifications.
