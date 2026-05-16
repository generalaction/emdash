/**
 * End-to-end integration test for the emdash MCP server stack.
 *
 * The other tests in this directory cover each layer in isolation:
 *  - `http-server.test.ts` exercises the raw HTTP gateway concerns (auth,
 *    Host header, lifecycle) with no MCP client on the other side.
 *  - `bin/emdash-mcp.test.ts` exercises the stdio bridge using
 *    `InMemoryTransport` instead of a real HTTP server.
 *  - The `tools/*.test.ts` and `resources/*.test.ts` suites exercise
 *    individual handlers in isolation.
 *
 * This test ties everything together: a real {@link McpHttpServer} on an
 * ephemeral port, a real token minted via {@link generateToken}, and a real
 * SDK {@link Client} over {@link StreamableHTTPClientTransport}. The goal is
 * to prove the transport + auth + SDK plumbing cooperates end-to-end —
 * **not** to re-test the full tool catalog (which would drag in Electron +
 * the DB). For that reason we hand-register a single trivial `echo` tool on
 * a fresh `McpServer` rather than calling `createMcpServer()`.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { McpHttpServer } from './http-server';
import { generateToken } from './token-store';

/** Builds a minimal `McpServer` with a single deterministic `echo` tool. */
function buildTestMcpServer(): McpServer {
  const server = new McpServer({ name: 'emdash-integration-test', version: '0.0.0' });
  server.registerTool(
    'echo',
    {
      description: 'Echoes the input text back as a single text content block.',
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({ content: [{ type: 'text', text }] })
  );
  return server;
}

describe('mcp-server end-to-end (HTTP + SDK client)', () => {
  let httpServer: McpHttpServer;
  let token: string;
  let port: number;

  beforeEach(async () => {
    httpServer = new McpHttpServer();
    token = generateToken();
    const { port: bound } = await httpServer.start({
      port: 0,
      token,
      mcpServerFactory: buildTestMcpServer,
    });
    port = bound;
  });

  afterEach(async () => {
    await httpServer.stop();
  });

  it('initialize succeeds with the correct bearer token', async () => {
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: { Authorization: `Bearer ${token}` },
      },
    });
    const client = new Client({ name: 'integration-test', version: '1' }, { capabilities: {} });
    try {
      await client.connect(transport);
      // If connect() resolves without throwing the MCP `initialize` round-trip
      // succeeded — that is the assertion. The server identity is whatever the
      // McpServer reported during initialize, so confirm it matches.
      const info = client.getServerVersion();
      expect(info).toMatchObject({ name: 'emdash-integration-test' });
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it('initialize fails without a bearer token (HTTP 401)', async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${port}/mcp`)
      // No requestInit.headers — Authorization is intentionally absent.
    );
    const client = new Client({ name: 'integration-test', version: '1' }, { capabilities: {} });
    let caught: unknown;
    try {
      await client.connect(transport);
    } catch (err) {
      caught = err;
    } finally {
      await client.close().catch(() => undefined);
      await transport.close().catch(() => undefined);
    }
    expect(caught).toBeInstanceOf(Error);
    // The SDK surfaces the HTTP transport error from the failed POST. Our
    // gateway returns `{"error":"unauthorized"}` with a 401 status; the SDK
    // bubbles up the body in the message, so we match on the body keyword.
    expect(String(caught)).toMatch(/unauthorized/i);
  });

  it('tools/list returns the registered tools', async () => {
    const client = await connectClient({ port, token });
    try {
      const result = await client.listTools();
      const names = result.tools.map((t) => t.name);
      expect(names).toContain('echo');
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it('tools/call round-trips through the SDK + HTTP transport', async () => {
    const client = await connectClient({ port, token });
    try {
      const result = await client.callTool({
        name: 'echo',
        arguments: { text: 'hello from integration test' },
      });
      expect(result.isError).not.toBe(true);
      expect(result.content).toMatchObject([{ type: 'text', text: 'hello from integration test' }]);
    } finally {
      await client.close().catch(() => undefined);
    }
  });

  it('rejects requests whose Host header does not match the bound port (HTTP 421)', async () => {
    // The SDK client always sets the right Host header, so to exercise the
    // DNS-rebinding guard we drive HTTP directly. We send the same JSON-RPC
    // initialize the SDK would, just with a spoofed Host.
    const body = await rawRequest({
      port,
      method: 'POST',
      path: '/mcp',
      headers: {
        Host: 'evil.example.com',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'host-header-probe', version: '0' },
        },
      }),
    });
    expect(body.statusCode).toBe(421);
  });

  it('supports multiple concurrent sessions on the same server', async () => {
    // Regression: a single McpServer instance can only be connected to one
    // transport at a time (the SDK throws "Already connected to a transport"
    // on the second connect()). The server must mint a fresh McpServer per
    // session via the factory. Drive two sequential `initialize` round-trips
    // and confirm both succeed and both can call tools.
    const first = await connectClient({ port, token });
    try {
      const second = await connectClient({ port, token });
      try {
        const r1 = await first.callTool({ name: 'echo', arguments: { text: 'first' } });
        const r2 = await second.callTool({ name: 'echo', arguments: { text: 'second' } });
        expect(r1.content).toMatchObject([{ type: 'text', text: 'first' }]);
        expect(r2.content).toMatchObject([{ type: 'text', text: 'second' }]);
      } finally {
        await second.close().catch(() => undefined);
      }
    } finally {
      await first.close().catch(() => undefined);
    }
  });

  it('stop() releases the port so a second server can bind to the same port', async () => {
    // The fixture's `afterEach` will run a second `stop()` — that's fine
    // because `stop()` is idempotent. What we assert here is that *during*
    // the test the port really is freed: a fresh `McpHttpServer` can claim
    // it. This catches regressions where a lingering socket / transport
    // keeps the port held open after `stop()` returns.
    const previousPort = port;
    await httpServer.stop();

    const second = new McpHttpServer();
    try {
      const { port: reboundPort } = await second.start({
        port: previousPort,
        token: generateToken(),
        mcpServerFactory: buildTestMcpServer,
      });
      expect(reboundPort).toBe(previousPort);
      expect(second.isRunning()).toBe(true);
    } finally {
      await second.stop();
    }
  });
});

// ── helpers ───────────────────────────────────────────────────────────────

async function connectClient(opts: { port: number; token: string }): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${opts.port}/mcp`),
    {
      requestInit: {
        headers: { Authorization: `Bearer ${opts.token}` },
      },
    }
  );
  const client = new Client({ name: 'integration-test', version: '1' }, { capabilities: {} });
  await client.connect(transport);
  return client;
}

/**
 * Send an HTTP request with full control over headers (including `Host`,
 * which `fetch()` reserves). Mirrors the helper in `http-server.test.ts` —
 * intentionally duplicated rather than shared so this test file remains a
 * self-contained "wire up the whole stack" probe.
 */
async function rawRequest(opts: {
  port: number;
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
}): Promise<{ statusCode: number; body: string }> {
  const { request } = await import('node:http');
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host: '127.0.0.1',
        port: opts.port,
        method: opts.method,
        path: opts.path,
        headers: opts.headers,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (opts.body) req.write(opts.body);
    req.end();
  });
}
