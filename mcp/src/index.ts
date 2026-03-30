#!/usr/bin/env tsx
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import http from 'http';

// ---------------------------------------------------------------------------
// Config file resolution
// ---------------------------------------------------------------------------

function getEmdashUserDataPath(): string {
  const platform = process.platform;
  if (platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'Emdash');
  } else if (platform === 'win32') {
    return join(process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'), 'Emdash');
  } else {
    // Linux / other
    return join(process.env['XDG_CONFIG_HOME'] ?? join(homedir(), '.config'), 'Emdash');
  }
}

interface McpTaskServerConfig {
  port: number;
  token: string;
}

function loadConfig(): McpTaskServerConfig {
  const configPath = join(getEmdashUserDataPath(), 'mcp-task-server.json');
  try {
    const raw = readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof (parsed as Record<string, unknown>).port === 'number' &&
      typeof (parsed as Record<string, unknown>).token === 'string'
    ) {
      return parsed as McpTaskServerConfig;
    }
    throw new Error('Invalid config format');
  } catch (err) {
    throw new Error(
      `Failed to load Emdash MCP config from ${configPath}. ` +
        `Make sure the Emdash desktop app is running. Error: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

// ---------------------------------------------------------------------------
// HTTP client helpers
// ---------------------------------------------------------------------------

function httpRequest(
  options: http.RequestOptions,
  body?: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
      });
    });
    req.setTimeout(15_000, () => {
      req.destroy(new Error('Request timed out after 15 s'));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getProjects(
  config: McpTaskServerConfig
): Promise<Array<{ id: string; name: string; path: string; isRemote: boolean }>> {
  const result = await httpRequest({
    hostname: '127.0.0.1',
    port: config.port,
    path: '/api/projects',
    method: 'GET',
    headers: { 'x-emdash-token': config.token },
  });

  if (result.statusCode !== 200) {
    throw new Error(`Failed to list projects: HTTP ${result.statusCode}`);
  }

  const parsed = JSON.parse(result.body) as {
    projects: Array<{ id: string; name: string; path: string; isRemote: boolean }>;
  };
  return parsed.projects;
}

async function listTasks(
  config: McpTaskServerConfig,
  projectId: string
): Promise<Array<{ id: string; name: string; status: string; agentId?: string; branch?: string }>> {
  const result = await httpRequest({
    hostname: '127.0.0.1',
    port: config.port,
    path: `/api/tasks?project_id=${encodeURIComponent(projectId)}`,
    method: 'GET',
    headers: { 'x-emdash-token': config.token },
  });

  if (result.statusCode !== 200) {
    throw new Error(`Failed to list tasks: HTTP ${result.statusCode}`);
  }

  const parsed = JSON.parse(result.body) as {
    tasks: Array<{ id: string; name: string; status: string; agentId?: string; branch?: string }>;
  };
  return parsed.tasks;
}

async function createTask(
  config: McpTaskServerConfig,
  params: { projectId: string; prompt: string; taskName?: string; agentId?: string }
): Promise<{ taskRequestId: string }> {
  const body = JSON.stringify(params);
  const result = await httpRequest(
    {
      hostname: '127.0.0.1',
      port: config.port,
      path: '/api/tasks',
      method: 'POST',
      headers: {
        'x-emdash-token': config.token,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    },
    body
  );

  if (result.statusCode !== 202) {
    let errorMsg = `HTTP ${result.statusCode}`;
    try {
      const parsed = JSON.parse(result.body) as { error?: string };
      if (parsed.error) errorMsg = parsed.error;
    } catch {}
    throw new Error(`Failed to create task: ${errorMsg}`);
  }

  return JSON.parse(result.body) as { taskRequestId: string };
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'emdash', version: '0.1.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'Use list_projects to discover available project IDs, then create_task to queue ' +
      'an AI agent task in a project. Tasks run asynchronously inside the Emdash desktop app.',
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_projects',
      description:
        'List all projects configured in the local Emdash desktop app. ' +
        'Call this first to get valid project IDs before calling create_task. ' +
        "Returns each project's id, name, path, and whether it is remote.",
      inputSchema: {
        type: 'object' as const,
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'list_tasks',
      description:
        'List active (non-archived) tasks for a project. ' +
        'Use this to confirm a task was created or to check which tasks are currently running. ' +
        'Returns each task\'s id, name, status ("idle" | "running" | "active"), agent, and branch.',
      inputSchema: {
        type: 'object' as const,
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
        type: 'object' as const,
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
            description:
              'Agent to use, e.g. "claude" or "codex". Defaults to "claude" when omitted.',
          },
        },
        required: ['project_id', 'prompt'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  let config: McpTaskServerConfig;
  try {
    config = loadConfig();
  } catch (err) {
    return {
      content: [
        {
          type: 'text' as const,
          text: `Error: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }

  if (name === 'list_projects') {
    try {
      const projects = await getProjects(config);
      if (projects.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No projects found in Emdash.' }],
        };
      }
      const lines = projects.map(
        (p) => `• ${p.name} (id: ${p.id})${p.isRemote ? ' [remote]' : ''}\n  path: ${p.path}`
      );
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing projects: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'list_tasks') {
    const typedArgs = args as Record<string, unknown>;
    const projectId = typedArgs['project_id'];
    if (typeof projectId !== 'string' || !projectId) {
      return {
        content: [{ type: 'text' as const, text: 'Error: project_id is required' }],
        isError: true,
      };
    }
    try {
      const tasks = await listTasks(config, projectId);
      if (tasks.length === 0) {
        return {
          content: [{ type: 'text' as const, text: 'No active tasks found for this project.' }],
        };
      }
      const lines = tasks.map(
        (t) =>
          `• ${t.name} (id: ${t.id})\n  status: ${t.status}  agent: ${t.agentId ?? 'unknown'}  branch: ${t.branch ?? 'unknown'}`
      );
      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error listing tasks: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  if (name === 'create_task') {
    const typedArgs = args as Record<string, unknown>;
    const projectId = typedArgs['project_id'];
    const prompt = typedArgs['prompt'];
    const taskName = typedArgs['task_name'];
    const agentId = typedArgs['agent_id'];

    if (typeof projectId !== 'string' || !projectId) {
      return {
        content: [{ type: 'text' as const, text: 'Error: project_id is required' }],
        isError: true,
      };
    }
    if (typeof prompt !== 'string' || !prompt) {
      return {
        content: [{ type: 'text' as const, text: 'Error: prompt is required' }],
        isError: true,
      };
    }

    try {
      const result = await createTask(config, {
        projectId,
        prompt,
        taskName: typeof taskName === 'string' ? taskName : undefined,
        agentId: typeof agentId === 'string' ? agentId : undefined,
      });
      return {
        content: [
          {
            type: 'text' as const,
            text: `Task queued successfully (request ID: ${result.taskRequestId}). The Emdash app will start the agent shortly.`,
          },
        ],
      };
    } catch (err) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error creating task: ${err instanceof Error ? err.message : String(err)}`,
          },
        ],
        isError: true,
      };
    }
  }

  return {
    content: [{ type: 'text' as const, text: `Unknown tool: ${name}` }],
    isError: true,
  };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
