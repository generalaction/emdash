import http from 'http';
import crypto from 'crypto';
import { BrowserWindow, app } from 'electron';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { databaseService } from './DatabaseService';
import { log } from '../lib/logger';

export interface McpTaskRequest {
  id: string;
  projectId: string;
  prompt: string;
  taskName?: string;
  agentId?: string;
}

// ---------------------------------------------------------------------------
// MCP tool definitions (reused for both /mcp and /api routes)
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: 'list_projects',
    description:
      'List all projects configured in the local Emdash desktop app. ' +
      'Call this first to get valid project IDs before calling create_task. ' +
      "Returns each project's id, name, path, and whether it is remote.",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'list_tasks',
    description:
      'List active (non-archived) tasks for a project. ' +
      'Use this to confirm a task was created or to check which tasks are currently running. ' +
      'Returns each task\'s id, name, status ("idle" | "running" | "active"), agent, and branch.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID of the project to list tasks for. Obtain from list_projects.',
        },
      },
      required: ['project_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'create_task',
    description:
      'Queue a new task in an existing Emdash project. Emdash will create a git worktree, ' +
      'save the task, and start the AI agent automatically — the call returns as soon as the ' +
      'task is queued, before the agent begins. Use list_projects first to find the project_id.',
    inputSchema: {
      type: 'object',
      properties: {
        project_id: {
          type: 'string',
          description: 'ID of the project to run the task in. Obtain from list_projects.',
        },
        prompt: {
          type: 'string',
          description: 'Instructions for the AI agent.',
        },
        task_name: {
          type: 'string',
          description:
            'Human-readable task name shown in the Emdash UI. Auto-generated if omitted.',
        },
        agent_id: {
          type: 'string',
          description: 'Agent to use, e.g. "claude" or "codex". Defaults to "claude" when omitted.',
        },
      },
      required: ['project_id', 'prompt'],
      additionalProperties: false,
    },
  },
];

interface McpToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// Server class
// ---------------------------------------------------------------------------

class McpTaskServer {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';
  private taskQueue: McpTaskRequest[] = [];

  drainQueue(): McpTaskRequest[] {
    return this.taskQueue.splice(0);
  }

  hasPendingTasks(): boolean {
    return this.taskQueue.length > 0;
  }

  /**
   * Start the server.
   *
   * Tries each candidate port by attempting to listen directly — no probe step,
   * which avoids a probe-then-listen TOCTOU race. Falls back to an ephemeral
   * port (0) as a last resort.
   */
  async start(preferredPort?: number): Promise<void> {
    if (this.server) return;

    this.token = crypto.randomUUID();
    const candidates = preferredPort
      ? [preferredPort, 17823, 17824, 17825, 17826, 17827].filter((p, i, a) => a.indexOf(p) === i)
      : [17823, 17824, 17825, 17826, 17827];
    // Append 0 as final fallback — OS assigns an ephemeral port
    candidates.push(0);

    const server = http.createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        log.error('[McpTaskServer] unhandled request error', { error: String(err) });
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    for (const port of candidates) {
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (err: Error) => {
            server.removeListener('error', onError);
            reject(err);
          };
          server.once('error', onError);
          server.listen(port, '127.0.0.1', () => {
            server.removeListener('error', onError);
            resolve();
          });
        });
        // Bind succeeded — commit
        const addr = server.address();
        if (addr && typeof addr === 'object') this.port = addr.port;
        this.server = server;
        this.persistConfig();
        log.info('[McpTaskServer] started', { port: this.port });
        return;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EADDRINUSE' && port !== 0) {
          continue; // Try the next candidate
        }
        server.close();
        log.error('[McpTaskServer] failed to start', { error: String(err) });
        throw err;
      }
    }

    server.close();
    throw new Error('No available port found for MCP task server');
  }

  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      this.port = 0;
    }
  }

  getPort(): number {
    return this.port;
  }

  // ---------------------------------------------------------------------------
  // Config persistence
  // ---------------------------------------------------------------------------

  private persistConfig(): void {
    try {
      const dir = app.getPath('userData');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const configPath = join(dir, 'mcp-task-server.json');
      writeFileSync(
        configPath,
        JSON.stringify({
          port: this.port,
          token: this.token,
          mcpUrl: `http://127.0.0.1:${this.port}/mcp`,
        }),
        'utf-8'
      );
    } catch (err) {
      log.warn('[McpTaskServer] failed to persist config', { error: String(err) });
    }
  }

  // ---------------------------------------------------------------------------
  // Request routing
  // ---------------------------------------------------------------------------

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // MCP endpoint — no token required (localhost-only security model)
    if (req.url === '/mcp') {
      await this.handleMcpRequest(req, res);
      return;
    }

    // Legacy REST API — requires token (used by the standalone mcp/ package)
    res.setHeader('Content-Type', 'application/json');
    const authToken = req.headers['x-emdash-token'];
    if (authToken !== this.token) {
      res.writeHead(403);
      res.end(JSON.stringify({ error: 'Forbidden' }));
      return;
    }

    if (req.method === 'GET' && req.url === '/api/projects') {
      await this.handleApiProjects(res);
      return;
    }

    if (req.method === 'GET' && req.url?.startsWith('/api/tasks')) {
      await this.handleApiGetTasks(req, res);
      return;
    }

    if (req.method === 'POST' && req.url === '/api/tasks') {
      await this.handleApiTasks(req, res);
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  // ---------------------------------------------------------------------------
  // MCP Streamable-HTTP transport (JSON-RPC 2.0 over POST)
  // Spec: https://modelcontextprotocol.io/specification/2025-03-26/basic/transports
  // ---------------------------------------------------------------------------

  private async handleMcpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    if (req.method !== 'POST') {
      // SSE (GET) not supported — this server only handles request/response
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Only POST is supported on /mcp' }));
      return;
    }

    const body = await readBody(req);
    let rpc: Record<string, unknown>;
    try {
      rpc = JSON.parse(body) as Record<string, unknown>;
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32700, message: 'Parse error' },
        })
      );
      return;
    }

    const { method, params, id } = rpc;

    // Notifications have no id — acknowledge with 202, no body
    if (id === undefined || id === null) {
      res.writeHead(202);
      res.end('');
      return;
    }

    const ok = (result: unknown) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result }));
    };
    const fail = (code: number, message: string) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }));
    };

    if (method === 'initialize') {
      // Negotiate protocol version: use the client's requested version if we support it,
      // otherwise fall back to our preferred version.
      const SUPPORTED = ['2025-03-26', '2024-11-05', '2024-10-07'];
      const PREFERRED = '2025-03-26';
      const requested = ((params as Record<string, unknown>)?.['protocolVersion'] as string) ?? '';
      const negotiated = SUPPORTED.includes(requested) ? requested : PREFERRED;

      ok({
        protocolVersion: negotiated,
        capabilities: { tools: {} },
        serverInfo: { name: 'emdash', version: '0.1.0' },
        instructions:
          'Use list_projects to discover available project IDs, then create_task to queue ' +
          'an AI agent task in a project. Tasks run asynchronously inside the Emdash desktop app.',
      });
      return;
    }

    if (method === 'tools/list') {
      ok({ tools: MCP_TOOLS });
      return;
    }

    if (method === 'tools/call') {
      const p = (params ?? {}) as Record<string, unknown>;
      const toolName = p['name'] as string;
      const args = (p['arguments'] ?? {}) as Record<string, unknown>;
      const result = await this.callTool(toolName, args);
      ok(result);
      return;
    }

    fail(-32601, 'Method not found');
  }

  private async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    if (name === 'list_projects') {
      try {
        const projects = await databaseService.getProjects();
        if (projects.length === 0) {
          return { content: [{ type: 'text', text: 'No projects found in Emdash.' }] };
        }
        const lines = projects.map((p) => {
          const remote = (p as unknown as Record<string, unknown>).isRemote ? ' [remote]' : '';
          return `• ${p.name} (id: ${p.id})${remote}\n  path: ${p.path}`;
        });
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error listing projects: ${String(err)}` }],
          isError: true,
        };
      }
    }

    if (name === 'list_tasks') {
      const projectId = args['project_id'];
      if (typeof projectId !== 'string' || !projectId) {
        return {
          content: [{ type: 'text', text: 'Error: project_id is required' }],
          isError: true,
        };
      }
      try {
        const tasks = await databaseService.getTasks(projectId);
        if (tasks.length === 0) {
          return { content: [{ type: 'text', text: 'No active tasks found for this project.' }] };
        }
        const lines = tasks.map(
          (t) =>
            `• ${t.name} (id: ${t.id})\n  status: ${t.status}  agent: ${t.agentId ?? 'unknown'}  branch: ${t.branch}`
        );
        return { content: [{ type: 'text', text: lines.join('\n') }] };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error listing tasks: ${String(err)}` }],
          isError: true,
        };
      }
    }

    if (name === 'create_task') {
      const projectId = args['project_id'];
      const prompt = args['prompt'];
      const taskName = args['task_name'];
      const agentId = args['agent_id'];

      if (typeof projectId !== 'string' || !projectId) {
        return {
          content: [{ type: 'text', text: 'Error: project_id is required' }],
          isError: true,
        };
      }
      if (typeof prompt !== 'string' || !prompt) {
        return { content: [{ type: 'text', text: 'Error: prompt is required' }], isError: true };
      }

      try {
        const projects = await databaseService.getProjects();
        if (!projects.find((p) => p.id === projectId)) {
          return {
            content: [{ type: 'text', text: `Error: project not found: ${projectId}` }],
            isError: true,
          };
        }

        const taskRequest: McpTaskRequest = {
          id: crypto.randomUUID(),
          projectId,
          prompt,
          taskName: typeof taskName === 'string' ? taskName : undefined,
          agentId: typeof agentId === 'string' ? agentId : undefined,
        };
        this.taskQueue.push(taskRequest);
        this.notifyRenderer();

        return {
          content: [
            {
              type: 'text',
              text: `Task queued (id: ${taskRequest.id}). Emdash will start the agent shortly.`,
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Error creating task: ${String(err)}` }],
          isError: true,
        };
      }
    }

    return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
  }

  // ---------------------------------------------------------------------------
  // Legacy REST API handlers
  // ---------------------------------------------------------------------------

  private async handleApiProjects(res: http.ServerResponse): Promise<void> {
    try {
      const projects = await databaseService.getProjects();
      const sanitized = projects.map((p) => ({
        id: p.id,
        name: p.name,
        path: p.path,
        isRemote: (p as unknown as Record<string, unknown>).isRemote ?? false,
      }));
      res.writeHead(200);
      res.end(JSON.stringify({ projects: sanitized }));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to list projects' }));
    }
  }

  private async handleApiGetTasks(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): Promise<void> {
    const url = new URL(req.url!, 'http://127.0.0.1');
    const projectId = url.searchParams.get('project_id');
    if (!projectId) {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'project_id is required' }));
      return;
    }
    try {
      const tasks = await databaseService.getTasks(projectId);
      const sanitized = tasks.map((t) => ({
        id: t.id,
        name: t.name,
        status: t.status,
        agentId: t.agentId,
        branch: t.branch,
      }));
      res.writeHead(200);
      res.end(JSON.stringify({ tasks: sanitized }));
    } catch {
      res.writeHead(500);
      res.end(JSON.stringify({ error: 'Failed to list tasks' }));
    }
  }

  private async handleApiTasks(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readBody(req, 100_000);
    try {
      const data = JSON.parse(body) as Record<string, unknown>;
      const { projectId, prompt, taskName, agentId } = data;

      if (!projectId || typeof projectId !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'projectId is required' }));
        return;
      }
      if (!prompt || typeof prompt !== 'string') {
        res.writeHead(400);
        res.end(JSON.stringify({ error: 'prompt is required' }));
        return;
      }

      const projects = await databaseService.getProjects();
      if (!projects.find((p) => p.id === projectId)) {
        res.writeHead(404);
        res.end(JSON.stringify({ error: `Project not found: ${projectId}` }));
        return;
      }

      const taskRequest: McpTaskRequest = {
        id: crypto.randomUUID(),
        projectId,
        prompt,
        taskName: typeof taskName === 'string' ? taskName : undefined,
        agentId: typeof agentId === 'string' ? agentId : undefined,
      };
      this.taskQueue.push(taskRequest);
      this.notifyRenderer();

      res.writeHead(202);
      res.end(JSON.stringify({ taskRequestId: taskRequest.id }));
    } catch {
      res.writeHead(400);
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
    }
  }

  // ---------------------------------------------------------------------------
  // Renderer notification
  // ---------------------------------------------------------------------------

  private notifyRenderer(): void {
    const target = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (target && !target.isDestroyed()) {
      target.webContents.send('mcp:taskAvailable');
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function readBody(req: http.IncomingMessage, maxBytes = 1_000_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let destroyed = false;
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString();
      if (body.length > maxBytes) {
        destroyed = true;
        req.destroy(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      if (!destroyed) resolve(body);
    });
    req.on('error', reject);
  });
}

export const mcpTaskServer = new McpTaskServer();
