import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HttpClient } from '../http-client';

/**
 * Set A — agent collaboration tools.
 *
 * Three tools land in PR1: agent_self, agent_observe, agent_send.
 * The remaining five (list_peers, spawn, interrupt, fetch, close) follow in PR2.
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
    'agent_observe',
    "Returns a peer agent's current status, recent events, and (when supported by the provider) the last assistant message. Optionally long-polls until the status changes.",
    {
      conversationId: z
        .string()
        .describe(
          'Target conversation ID. Use agent_self to discover own ID, or agent_list_peers (PR2).'
        ),
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
    'agent_send',
    "Sends a message to a peer agent's PTY (like typing into their terminal). Same-task only by default; pass crossTask=true for cross-task delivery (capability-gated).",
    {
      conversationId: z.string().describe('Target conversation ID.'),
      message: z
        .string()
        .describe("Text to inject into target's stdin. A trailing newline is added automatically."),
      crossTask: z
        .boolean()
        .optional()
        .describe(
          'Set true to allow delivery to a conversation in a different task. Server returns 403 if the cross-task:write capability is disabled.'
        ),
    },
    async ({ conversationId, message, crossTask }) => {
      const data = await http.post(`/agent/${conversationId}/send`, { message, crossTask });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );
}
