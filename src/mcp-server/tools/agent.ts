import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HttpClient } from '../http-client';

/**
 * Set A — agent collaboration tools (PR1 + PR2).
 */
export function registerAgentTools(server: McpServer, http: HttpClient): void {
  server.tool(
    'agent_self',
    "Returns the calling agent's identity within emdash: conversationId, taskId, projectId, providerId, name.",
    {},
    async () => {
      const data = await http.get('/agent/self');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'agent_list_peers',
    "Lists peer agents the caller can see. Default scope='task' returns only peers in the same task — almost always what you want. scope='project' covers other tasks in the same project; scope='all' covers every running conversation. Cross-task awareness is fine, but cross-task writes (agent_send/interrupt with crossTask=true) are discouraged unless the user explicitly asked for orchestration across tasks.",
    {
      scope: z
        .enum(['task', 'project', 'all'])
        .optional()
        .describe("Default 'task'. 'project' or 'all' enable wider visibility for orchestration."),
    },
    async ({ scope }) => {
      const data = await http.get('/agent/peers', scope ? { scope } : undefined);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'agent_spawn',
    'Spawns a new peer conversation in the same task. Use for parallel sub-agent patterns (one researcher + one implementer in the same worktree). Cross-task spawn is not part of v1 — use task_create (PR4) when you need a new task.',
    {
      providerId: z
        .string()
        .describe('Agent CLI provider id, e.g. "claude", "codex", "copilot", "gemini".'),
      name: z.string().optional().describe('Optional title shown in the tab bar.'),
      initialPrompt: z
        .string()
        .optional()
        .describe("First message delivered to the spawned agent's stdin."),
    },
    async ({ providerId, name, initialPrompt }) => {
      const data = await http.post('/agent/spawn', {
        providerId,
        ...(name ? { name } : {}),
        ...(initialPrompt ? { initialPrompt } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'agent_observe',
    "Returns a peer agent's current status, recent events, and (when the provider supports hooks) the last assistant message. Optionally long-polls until the status changes — useful for waiting on a peer to finish.",
    {
      conversationId: z
        .string()
        .describe('Target conversation ID. Discover via agent_self / agent_list_peers.'),
      waitForChange: z
        .boolean()
        .optional()
        .describe("If true, block until the target's status transitions or timeoutMs elapses."),
      timeoutMs: z
        .number()
        .int()
        .min(1000)
        .max(60000)
        .optional()
        .describe('Long-poll timeout in milliseconds. Default 30000.'),
    },
    async ({ conversationId, waitForChange, timeoutMs }) => {
      const data = await http.get(`/agent/${conversationId}/observe`, {
        ...(waitForChange ? { waitForChange: true } : {}),
        ...(timeoutMs ? { timeoutMs } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'agent_fetch',
    "Pulls events or terminal scrollback from a peer agent. The response is discriminated by `kind`: kind='events' returns `{ kind:'events', events: AgentEvent[], nextCursor? }`; kind='scrollback' returns `{ kind:'scrollback', scrollback: string }` (raw PTY ring buffer, last ~64KB). transcript fetch lands in PR3.",
    {
      conversationId: z.string().describe('Target conversation ID.'),
      kind: z
        .enum(['events', 'scrollback', 'transcript'])
        .describe("'events' for structured agent events, 'scrollback' for raw terminal output."),
      limit: z
        .number()
        .int()
        .positive()
        .optional()
        .describe('events: cap on items returned. scrollback: cap on bytes returned (from tail).'),
      since: z
        .string()
        .optional()
        .describe(
          'events: opaque cursor from a prior response (its nextCursor). Treat as a black box.'
        ),
    },
    async ({ conversationId, kind, limit, since }) => {
      const data = await http.get(`/agent/${conversationId}/fetch`, {
        kind,
        ...(limit ? { limit } : {}),
        ...(since ? { since } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'agent_send',
    "Sends a message to a peer agent's PTY (like typing into their terminal). With submit=true (default), the message is auto-submitted as a turn. With submit=false, the text is typed into the agent's input box but enter is not pressed — useful for staging a draft the user can review and edit. Same-task only by default; crossTask=true permits delivery into a different task and is discouraged unless user-requested.",
    {
      conversationId: z.string().describe('Target conversation ID.'),
      message: z.string().describe("Text to inject into target's stdin."),
      submit: z
        .boolean()
        .optional()
        .describe(
          'Auto-submit the message as a turn. Default true. Set false to stage the text as an unsent draft.'
        ),
      crossTask: z
        .boolean()
        .optional()
        .describe(
          'Allow delivery to a conversation in a different task. Discouraged unless user-requested.'
        ),
    },
    async ({ conversationId, message, submit, crossTask }) => {
      const data = await http.post(`/agent/${conversationId}/send`, {
        message,
        ...(submit !== undefined ? { submit } : {}),
        ...(crossTask !== undefined ? { crossTask } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'agent_interrupt',
    "Sends a Ctrl-C (\\x03) to a peer agent's PTY, interrupting its current operation without killing the session. Same-task only by default; crossTask=true is permitted but discouraged unless explicitly user-requested.",
    {
      conversationId: z.string().describe('Target conversation ID.'),
      crossTask: z
        .boolean()
        .optional()
        .describe('Allow interrupting a conversation in a different task. Use sparingly.'),
    },
    async ({ conversationId, crossTask }) => {
      const data = await http.post(`/agent/${conversationId}/interrupt`, {
        ...(crossTask !== undefined ? { crossTask } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );
}
