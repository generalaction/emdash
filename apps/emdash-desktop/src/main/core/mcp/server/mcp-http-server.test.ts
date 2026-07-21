import { promises as fs } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  userDataDir: '',
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => mocks.userDataDir,
    getVersion: () => '0.0.0-test',
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Replace the real tool registry with a minimal echo server so these tests
// exercise the HTTP layer (auth, allowlists, body handling) end to end without
// pulling in the app's db/task services.
vi.mock('./register-tools', async () => {
  const { McpServer } = await import('@modelcontextprotocol/sdk/server/mcp.js');
  const { z } = await import('zod');
  return {
    buildEmdashMcpServer: () => {
      const server = new McpServer({ name: 'test', version: '0.0.0' });
      server.registerTool(
        'echo',
        { description: 'echoes its input', inputSchema: { text: z.string() } },
        async ({ text }: { text: string }) => ({
          content: [{ type: 'text' as const, text }],
        })
      );
      return server;
    },
  };
});

const { McpHttpServer } = await import('./mcp-http-server');

type RawResponse = { status: number; body: string };

function rawRequest(options: {
  port: number;
  path?: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  splitBodyAt?: number;
}): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: '127.0.0.1',
        port: options.port,
        path: options.path ?? '/mcp',
        method: options.method ?? 'POST',
        headers: options.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') })
        );
      }
    );
    req.on('error', reject);
    if (options.body === undefined) {
      req.end();
      return;
    }
    const buffer = Buffer.from(options.body, 'utf8');
    if (options.splitBodyAt === undefined) {
      req.end(buffer);
      return;
    }
    req.write(buffer.subarray(0, options.splitBodyAt));
    setTimeout(() => req.end(buffer.subarray(options.splitBodyAt)), 10);
  });
}

function jsonRpcHeaders(token: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    authorization: `Bearer ${token}`,
  };
}

describe('McpHttpServer', () => {
  let server: InstanceType<typeof McpHttpServer>;

  beforeEach(async () => {
    mocks.userDataDir = await fs.mkdtemp(path.join(tmpdir(), 'emdash-mcp-test-'));
    server = new McpHttpServer(0);
  });

  afterEach(async () => {
    await server.stop();
    await fs.rm(mocks.userDataDir, { recursive: true, force: true });
  });

  function connectionInfo(): { port: number; token: string } {
    const info = server.getConnectionInfo();
    if (!info) throw new Error('server not running');
    return { port: Number(new URL(info.url).port), token: info.token };
  }

  describe('lifecycle', () => {
    it('reports not-running before start and after stop', async () => {
      expect(server.getConnectionInfo()).toBeNull();
      await server.start();
      expect(server.getConnectionInfo()).not.toBeNull();
      await server.stop();
      expect(server.getConnectionInfo()).toBeNull();
    });

    it('shares one listener across concurrent start calls', async () => {
      await Promise.all([server.start(), server.start()]);
      const info = server.getConnectionInfo();
      expect(info).not.toBeNull();
      await server.stop();
      expect(server.getConnectionInfo()).toBeNull();
    });

    it('binds an ephemeral port and reports the real port in the url', async () => {
      await server.start();
      const info = server.getConnectionInfo();
      expect(info).not.toBeNull();
      const url = new URL(info!.url);
      expect(url.hostname).toBe('127.0.0.1');
      expect(url.pathname).toBe('/mcp');
      expect(Number(url.port)).toBeGreaterThan(0);
    });

    it('is a no-op when started twice', async () => {
      await server.start();
      const first = server.getConnectionInfo();
      await server.start();
      expect(server.getConnectionInfo()).toEqual(first);
    });

    it('reports not-running when the port is already in use', async () => {
      await server.start();
      const { port } = connectionInfo();
      const second = new McpHttpServer(port);
      await expect(second.start()).rejects.toThrow();
      expect(second.getConnectionInfo()).toBeNull();
    });
  });

  describe('token persistence', () => {
    it('generates a hex token and persists it with owner-only permissions', async () => {
      await server.start();
      const { token } = connectionInfo();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      const tokenPath = path.join(mocks.userDataDir, 'mcp-server-token');
      expect((await fs.readFile(tokenPath, 'utf8')).trim()).toBe(token);
      if (process.platform !== 'win32') {
        const stat = await fs.stat(tokenPath);
        expect(stat.mode & 0o777).toBe(0o600);
      }
    });

    it('reuses the persisted token across restarts', async () => {
      await server.start();
      const { token } = connectionInfo();
      await server.stop();
      await server.start();
      expect(connectionInfo().token).toBe(token);
    });
  });

  describe('request filtering', () => {
    let port = 0;
    let token = '';

    beforeEach(async () => {
      await server.start();
      ({ port, token } = connectionInfo());
    });

    it('returns 404 for paths other than /mcp', async () => {
      const res = await rawRequest({ port, path: '/other', headers: jsonRpcHeaders(token) });
      expect(res.status).toBe(404);
    });

    it('returns 403 for a non-local Host header (DNS rebinding)', async () => {
      const res = await rawRequest({
        port,
        headers: { ...jsonRpcHeaders(token), host: 'evil.example.com' },
      });
      expect(res.status).toBe(403);
    });

    it('returns 403 for a non-local Origin header', async () => {
      const res = await rawRequest({
        port,
        headers: { ...jsonRpcHeaders(token), origin: 'https://evil.example.com' },
      });
      expect(res.status).toBe(403);
    });

    it('accepts a local Origin header', async () => {
      const res = await rawRequest({
        port,
        headers: { ...jsonRpcHeaders(token), origin: `http://127.0.0.1:${port}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 401 without an Authorization header', async () => {
      const headers = jsonRpcHeaders(token);
      delete headers.authorization;
      const res = await rawRequest({ port, headers });
      expect(res.status).toBe(401);
    });

    it('returns 401 for a wrong bearer token', async () => {
      const res = await rawRequest({ port, headers: jsonRpcHeaders('0'.repeat(64)) });
      expect(res.status).toBe(401);
    });

    it('accepts a lowercase "bearer" auth scheme', async () => {
      const res = await rawRequest({
        port,
        headers: { ...jsonRpcHeaders(token), authorization: `bearer ${token}` },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(200);
    });

    it('returns 405 for non-POST methods', async () => {
      const res = await rawRequest({ port, method: 'GET', headers: jsonRpcHeaders(token) });
      expect(res.status).toBe(405);
    });

    it('returns 400 for a body that is not valid JSON', async () => {
      const res = await rawRequest({ port, headers: jsonRpcHeaders(token), body: 'not json' });
      expect(res.status).toBe(400);
    });

    it('rejects bodies over the size cap with 413', async () => {
      const oversized = `"${'a'.repeat(4_000_001)}"`;
      const res = await rawRequest({ port, headers: jsonRpcHeaders(token), body: oversized });
      expect(res.status).toBe(413);
    });
  });

  describe('MCP requests', () => {
    let port = 0;
    let token = '';

    beforeEach(async () => {
      await server.start();
      ({ port, token } = connectionInfo());
    });

    it('serves tools/list for an authorized request', async () => {
      const res = await rawRequest({
        port,
        headers: jsonRpcHeaders(token),
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.result.tools.map((tool: { name: string }) => tool.name)).toEqual(['echo']);
    });

    it('round-trips multibyte input split across body chunks', async () => {
      const text = 'héllo 🚀 wörld — 日本語';
      const body = JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'echo', arguments: { text } },
      });
      // Split mid-way through the rocket emoji's 4-byte UTF-8 sequence so the
      // two writes arrive as separate chunks; per-chunk decoding would corrupt it.
      const splitBodyAt = Buffer.from(body, 'utf8').indexOf(Buffer.from('🚀', 'utf8')) + 2;
      const res = await rawRequest({
        port,
        headers: jsonRpcHeaders(token),
        body,
        splitBodyAt,
      });
      expect(res.status).toBe(200);
      const parsed = JSON.parse(res.body);
      expect(parsed.result.content).toEqual([{ type: 'text', text }]);
    });
  });
});
