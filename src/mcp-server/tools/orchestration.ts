import { type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { HttpClient } from '../http-client';

/**
 * PR4 — orchestration + workspace awareness + terminals.
 *
 * task_list, task_create — minimal task CRUD for orchestration patterns.
 * workspace_dev_servers — list URLs of dev servers running in the caller's
 *   task (auto-detected from terminal output).
 * terminal_list, terminal_send, terminal_create — let agents drive
 *   terminal commands without copy-paste.
 */
export function registerOrchestrationTools(server: McpServer, http: HttpClient): void {
  server.tool(
    'task_list',
    "Lists tasks. Defaults to the caller's project; pass a different projectId to look elsewhere. Active tasks only by default.",
    {
      projectId: z.string().optional().describe("Project ID. Defaults to caller's project."),
      includeArchived: z.boolean().optional().describe('Include archived tasks. Default false.'),
    },
    async ({ projectId, includeArchived }) => {
      const data = await http.get('/tasks', {
        ...(projectId ? { projectId } : {}),
        ...(includeArchived ? { includeArchived: true } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'task_create',
    "Creates a new task in a project, optionally seeded with an initial conversation. Use to kick off parallel work that requires its own worktree (a research agent spawning an implementation task, for example). Defaults projectId to caller's; sourceBranch defaults to project's baseRef.",
    {
      projectId: z.string().optional().describe("Project to create task in. Defaults to caller's."),
      name: z.string().describe('Task name (also used as default task branch).'),
      sourceBranch: z
        .string()
        .optional()
        .describe("Branch to fork from. Defaults to project's baseRef."),
      taskBranch: z
        .string()
        .optional()
        .describe('Custom name for the new task branch. Defaults to task name.'),
      initialPrompt: z
        .string()
        .optional()
        .describe('First message delivered to the seeded conversation.'),
      providerId: z
        .string()
        .optional()
        .describe('Agent provider id to seed the task with (claude, codex, etc.).'),
    },
    async (params) => {
      const data = await http.post('/tasks', params);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'workspace_dev_servers',
    "Lists dev server URLs detected running in the caller's task. Useful for testing agents that need to curl a running server they don't have visibility into.",
    {},
    async () => {
      const data = await http.get('/workspace/dev-servers');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'terminal_list',
    "Lists terminals open in the caller's task. Use before terminal_send so you know which terminal IDs exist.",
    {},
    async () => {
      const data = await http.get('/terminals');
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'terminal_send',
    "Appends text to an existing terminal in the caller's task. With submit=true, also sends a newline so the command runs.",
    {
      terminalId: z.string().describe('Terminal ID. Discover via terminal_list.'),
      text: z.string().describe('Text to type into the terminal.'),
      submit: z.boolean().optional().describe('If true, append \\n to execute the command.'),
    },
    async ({ terminalId, text, submit }) => {
      const data = await http.post(`/terminals/${terminalId}/send`, {
        text,
        ...(submit !== undefined ? { submit } : {}),
      });
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );

  server.tool(
    'terminal_create',
    "Opens a new terminal in the caller's task worktree. Optional initialCommand is auto-typed and submitted. Use this to drop a command the user should run without making them copy-paste.",
    {
      initialCommand: z
        .string()
        .optional()
        .describe('Command auto-typed + submitted on terminal startup.'),
      name: z.string().optional().describe('Terminal name shown in the drawer.'),
      focus: z
        .boolean()
        .optional()
        .describe('Open the terminal drawer if closed. Currently no-op (PR4 v1).'),
    },
    async (params) => {
      const data = await http.post('/terminals', params);
      return { content: [{ type: 'text', text: JSON.stringify(data) }] };
    }
  );
}
