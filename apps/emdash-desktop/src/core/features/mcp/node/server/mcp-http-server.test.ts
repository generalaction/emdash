import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { McpHttpServer } from './mcp-http-server';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as never;

function buildServer(): McpServer {
  const server = new McpServer({ name: 'emdash-test', version: '0.0.0' });
  server.registerTool(
    'ping',
    { title: 'Ping', description: 'Ping', inputSchema: {} },
    async () => ({ content: [{ type: 'text' as const, text: 'pong' }] })
  );
  return server;
}

describe('McpHttpServer', () => {
  let tokenFilePath: string;
  let server: McpHttpServer;

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emdash-mcp-'));
    tokenFilePath = join(dir, 'mcp-token');
    // Port 0: an ephemeral port keeps parallel test runs off the real default.
    server = new McpHttpServer({ tokenFilePath, logger, buildServer, portOverride: 0 });
  });

  afterEach(async () => {
    await server.stop();
  });

  it('reports no connection info until it is listening', async () => {
    expect(server.getConnectionInfo()).toBeNull();
    await server.start();
    expect(server.getConnectionInfo()).not.toBeNull();
    await server.stop();
    expect(server.getConnectionInfo()).toBeNull();
  });

  it('creates a token file on first start and reuses it afterwards', async () => {
    await server.start();
    const first = server.getConnectionInfo()?.token;
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect((await readFile(tokenFilePath, 'utf8')).trim()).toBe(first);

    await server.stop();
    await server.start();
    expect(server.getConnectionInfo()?.token).toBe(first);
  });

  it('reuses a token written by a previous run', async () => {
    await writeFile(tokenFilePath, 'preexisting-token\n');
    await server.start();
    expect(server.getConnectionInfo()?.token).toBe('preexisting-token');
  });

  it('rejects requests without a valid bearer token', async () => {
    await server.start();
    const url = server.getConnectionInfo()!.url;

    await expect(post(url, {}, {})).resolves.toBe(401);
    await expect(post(url, { authorization: 'Bearer nope' }, {})).resolves.toBe(401);
  });

  it('accepts a bearer token in any letter case of the scheme', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    await expect(post(url, { authorization: `bearer ${token}` }, initialize())).resolves.toBe(200);
  });

  it('answers a tools/list call for an authenticated caller', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result?: { tools?: Array<{ name: string }> } };
    expect(body.result?.tools?.map((tool) => tool.name)).toEqual(['ping']);
  });

  it('rejects a non-local Host header', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    // fetch() refuses to set Host, so this one goes out over a raw request.
    await expect(
      rawPost(url, { authorization: `Bearer ${token}`, host: 'evil.example.com' }, initialize())
    ).resolves.toBe(403);
  });

  it('rejects a non-local Origin header', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    await expect(
      post(
        url,
        { authorization: `Bearer ${token}`, origin: 'https://evil.example.com' },
        initialize()
      )
    ).resolves.toBe(403);
  });

  it('serves only its own path', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;
    const otherPath = new URL('/other', url).toString();

    await expect(post(otherPath, { authorization: `Bearer ${token}` }, {})).resolves.toBe(404);
  });

  it('rejects methods other than POST', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    const response = await fetch(url, {
      method: 'GET',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.status).toBe(405);
  });

  it('rejects a body that is not valid JSON', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: 'not json',
    });
    expect(response.status).toBe(400);
  });

  it('rejects an oversized body', async () => {
    await server.start();
    const { url, token } = server.getConnectionInfo()!;

    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: 'x'.repeat(5_000_000),
    });
    expect(response.status).toBe(413);
  });
});

function initialize() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '0.0.0' },
    },
  };
}

function rawPost(url: string, headers: Record<string, string>, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const payload = JSON.stringify(body);
    const request = http.request(
      {
        host: '127.0.0.1',
        port: target.port,
        path: target.pathname,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(payload),
          ...headers,
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      }
    );
    request.on('error', reject);
    request.end(payload);
  });
}

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<number> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      ...headers,
    },
    body: JSON.stringify(body),
  });
  return response.status;
}
