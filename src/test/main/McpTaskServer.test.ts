import http from 'http';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks — must come before the module under test is imported
// ---------------------------------------------------------------------------

const getProjectsMock = vi.fn();
const getTasksMock = vi.fn();

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/tmp/emdash-mcp-test') },
  BrowserWindow: {
    getFocusedWindow: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

vi.mock('../../main/services/DatabaseService', () => ({
  databaseService: {
    getProjects: (...args: any[]) => getProjectsMock(...args),
    getTasks: (...args: any[]) => getTasksMock(...args),
  },
}));

vi.mock('../../main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('fs', () => ({
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn(() => true),
}));

import { mcpTaskServer } from '../../main/services/McpTaskServer';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function httpRequest(
  port: number,
  options: http.RequestOptions,
  body?: string
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, ...options }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () =>
        resolve({ statusCode: res.statusCode ?? 0, headers: res.headers, body: data })
      );
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function mcpPost(port: number, rpc: unknown) {
  const body = JSON.stringify(rpc);
  return httpRequest(
    port,
    {
      path: '/mcp',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    },
    body
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('McpTaskServer — queue helpers (no server needed)', () => {
  beforeEach(() => {
    mcpTaskServer.drainQueue();
  });

  it('hasPendingTasks returns false on empty queue', () => {
    expect(mcpTaskServer.hasPendingTasks()).toBe(false);
  });

  it('drainQueue returns empty array when queue is empty', () => {
    expect(mcpTaskServer.drainQueue()).toEqual([]);
  });
});

describe('McpTaskServer — HTTP server', () => {
  let port: number;

  // Start once for the whole group to avoid repeated stop/start timing issues.
  beforeAll(async () => {
    await mcpTaskServer.start();
    port = mcpTaskServer.getPort();
  });

  afterAll(() => {
    mcpTaskServer.stop();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mcpTaskServer.drainQueue();
  });

  // -------------------------------------------------------------------------
  // MCP transport
  // -------------------------------------------------------------------------

  describe('GET /mcp', () => {
    it('returns 405 with Allow: POST header', async () => {
      const res = await httpRequest(port, { path: '/mcp', method: 'GET' });
      expect(res.statusCode).toBe(405);
      expect(res.headers['allow']).toBe('POST');
    });
  });

  describe('POST /mcp — protocol', () => {
    it('returns 400 on invalid JSON', async () => {
      const body = 'not-json{{{';
      const res = await httpRequest(
        port,
        {
          path: '/mcp',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        },
        body
      );
      expect(res.statusCode).toBe(400);
      const parsed = JSON.parse(res.body);
      expect(parsed.error.code).toBe(-32700);
    });

    it('acknowledges notifications (no id) with 202 and empty body', async () => {
      const res = await mcpPost(port, { jsonrpc: '2.0', method: 'notifications/initialized' });
      expect(res.statusCode).toBe(202);
      expect(res.body).toBe('');
    });

    it('returns -32601 for unknown methods', async () => {
      const res = await mcpPost(port, { jsonrpc: '2.0', id: 1, method: 'unknown/method' });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).error.code).toBe(-32601);
    });
  });

  describe('POST /mcp — initialize', () => {
    it('negotiates the requested protocol version when supported', async () => {
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      const body = JSON.parse(res.body);
      expect(body.result.protocolVersion).toBe('2025-03-26');
      expect(body.result.serverInfo.name).toBe('emdash');
    });

    it('falls back to preferred version for unsupported client version', async () => {
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '1999-01-01',
          capabilities: {},
          clientInfo: { name: 'test', version: '1' },
        },
      });
      expect(JSON.parse(res.body).result.protocolVersion).toBe('2025-03-26');
    });
  });

  describe('POST /mcp — tools/list', () => {
    it('returns the three MCP tools', async () => {
      const res = await mcpPost(port, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
      const names = JSON.parse(res.body).result.tools.map((t: { name: string }) => t.name);
      expect(names).toEqual(expect.arrayContaining(['list_projects', 'list_tasks', 'create_task']));
      expect(names).toHaveLength(3);
    });
  });

  describe('POST /mcp — tools/call: list_projects', () => {
    it('returns a message when no projects exist', async () => {
      getProjectsMock.mockResolvedValue([]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      });
      expect(JSON.parse(res.body).result.content[0].text).toContain('No projects found');
    });

    it('lists projects with id, name, and path', async () => {
      getProjectsMock.mockResolvedValue([
        { id: 'p1', name: 'Alpha', path: '/code/alpha' },
        { id: 'p2', name: 'Beta', path: '/code/beta' },
      ]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      });
      const text = JSON.parse(res.body).result.content[0].text;
      expect(text).toContain('Alpha');
      expect(text).toContain('p1');
      expect(text).toContain('/code/alpha');
    });

    it('marks remote projects with [remote]', async () => {
      getProjectsMock.mockResolvedValue([{ id: 'p1', name: 'Remote', path: '/r', isRemote: true }]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      });
      expect(JSON.parse(res.body).result.content[0].text).toContain('[remote]');
    });

    it('returns isError on database failure', async () => {
      getProjectsMock.mockRejectedValue(new Error('db down'));
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_projects', arguments: {} },
      });
      expect(JSON.parse(res.body).result.isError).toBe(true);
    });
  });

  describe('POST /mcp — tools/call: list_tasks', () => {
    it('returns isError when project_id is missing', async () => {
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: {} },
      });
      expect(JSON.parse(res.body).result.isError).toBe(true);
    });

    it('returns a message when no tasks exist', async () => {
      getTasksMock.mockResolvedValue([]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: { project_id: 'p1' } },
      });
      expect(JSON.parse(res.body).result.content[0].text).toContain('No active tasks');
    });

    it('lists tasks with id, name, status, agent, and branch', async () => {
      getTasksMock.mockResolvedValue([
        {
          id: 't1',
          name: 'Fix bug',
          status: 'running',
          agentId: 'claude',
          branch: 'emdash/fix-bug',
        },
      ]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'list_tasks', arguments: { project_id: 'p1' } },
      });
      const text = JSON.parse(res.body).result.content[0].text;
      expect(text).toContain('Fix bug');
      expect(text).toContain('running');
      expect(text).toContain('claude');
    });
  });

  describe('POST /mcp — tools/call: create_task', () => {
    it('returns isError when project_id is missing', async () => {
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { prompt: 'do stuff' } },
      });
      expect(JSON.parse(res.body).result.isError).toBe(true);
    });

    it('returns isError when prompt is missing', async () => {
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { project_id: 'p1' } },
      });
      expect(JSON.parse(res.body).result.isError).toBe(true);
    });

    it('returns isError when project does not exist', async () => {
      getProjectsMock.mockResolvedValue([{ id: 'other', name: 'Other', path: '/' }]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { project_id: 'missing', prompt: 'do stuff' } },
      });
      expect(JSON.parse(res.body).result.isError).toBe(true);
    });

    it('queues a task and returns its id', async () => {
      getProjectsMock.mockResolvedValue([{ id: 'p1', name: 'Alpha', path: '/' }]);
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'create_task',
          arguments: {
            project_id: 'p1',
            prompt: 'fix the bug',
            task_name: 'Bug fix',
            agent_id: 'claude',
          },
        },
      });
      const text = JSON.parse(res.body).result.content[0].text;
      expect(text).toContain('queued');

      const queued = mcpTaskServer.drainQueue();
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({
        projectId: 'p1',
        prompt: 'fix the bug',
        taskName: 'Bug fix',
        agentId: 'claude',
      });
      expect(queued[0].id).toBeTruthy();
    });

    it('drainQueue empties the queue after two tasks', async () => {
      getProjectsMock.mockResolvedValue([{ id: 'p1', name: 'Alpha', path: '/' }]);
      await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { project_id: 'p1', prompt: 'task 1' } },
      });
      await mcpPost(port, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'create_task', arguments: { project_id: 'p1', prompt: 'task 2' } },
      });
      expect(mcpTaskServer.hasPendingTasks()).toBe(true);
      expect(mcpTaskServer.drainQueue()).toHaveLength(2);
      expect(mcpTaskServer.hasPendingTasks()).toBe(false);
    });
  });

  describe('POST /mcp — unknown tool', () => {
    it('returns isError for an unknown tool name', async () => {
      const res = await mcpPost(port, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'nonexistent_tool', arguments: {} },
      });
      const result = JSON.parse(res.body).result;
      expect(result.isError).toBe(true);
      expect(result.content[0].text).toContain('Unknown tool');
    });
  });

  // -------------------------------------------------------------------------
  // Legacy REST API
  // -------------------------------------------------------------------------

  describe('REST API — /api/projects', () => {
    it('returns 403 without token', async () => {
      const res = await httpRequest(port, { path: '/api/projects', method: 'GET' });
      expect(res.statusCode).toBe(403);
    });

    it('returns 403 with wrong token', async () => {
      const res = await httpRequest(port, {
        path: '/api/projects',
        method: 'GET',
        headers: { 'x-emdash-token': 'wrong-token' },
      });
      expect(res.statusCode).toBe(403);
    });
  });

  describe('REST API — unknown routes', () => {
    it('auth is checked before routing — unknown path without token returns 403', async () => {
      const res = await httpRequest(port, { path: '/api/unknown', method: 'GET' });
      expect(res.statusCode).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // Server lifecycle
  // -------------------------------------------------------------------------

  describe('start/stop', () => {
    it('getPort returns a non-zero port while running', () => {
      expect(mcpTaskServer.getPort()).toBeGreaterThan(0);
    });

    it('start() is idempotent — second call does not restart the server', async () => {
      const portBefore = mcpTaskServer.getPort();
      await mcpTaskServer.start();
      expect(mcpTaskServer.getPort()).toBe(portBefore);
    });

    it('getPort returns 0 after stop, and server can be restarted', async () => {
      mcpTaskServer.stop();
      expect(mcpTaskServer.getPort()).toBe(0);
      // Restart so afterAll and any remaining tests still have a running server.
      await mcpTaskServer.start();
      port = mcpTaskServer.getPort();
      expect(port).toBeGreaterThan(0);
    });
  });
});
