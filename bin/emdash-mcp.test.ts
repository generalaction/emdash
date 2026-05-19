/**
 * Tests for `bin/emdash-mcp.ts` — the stdio bridge that external MCP clients
 * (Claude Code, Cursor, Codex) spawn to talk to a running emdash app.
 *
 * Strategy: **unit tests + in-memory end-to-end** (NOT subprocess smoke).
 *
 * The spec (T9) suggested a subprocess smoke test as the primary approach
 * with a unit-test fallback if it turned out flaky. We took the unit route
 * up-front because:
 *
 *  1. The subprocess approach requires either a built `out/main/emdash-mcp.js`
 *     (electron-vite build step before the test runs — slow, not free in CI)
 *     or `node --experimental-strip-types bin/emdash-mcp.ts` (works locally
 *     on Node 22+ but `bin/emdash-mcp.ts` imports from `../src/...`, which
 *     itself transitively imports vite-only `import.meta.env` — strip-types
 *     can't transform that).
 *  2. The bridge's interesting behaviour — request forwarding, notification
 *     forwarding, retries on connect, graceful shutdown — is exercised more
 *     directly by wiring two SDK `Server`s and a `Client` together via
 *     `InMemoryTransport.createLinkedPair()`. The wire-format ping-pong is
 *     already covered by the SDK's own test suite.
 *
 * What we cover:
 *
 *  - `resolveBridgeConfig`: token-file present / missing / port override.
 *  - `buildMcpUrl`: loopback enforcement.
 *  - `connectHttpWithRetry`: backoff + max-attempt behaviour.
 *  - `installPassthroughHandlers`: request relay end-to-end against a stub
 *    "upstream" `McpServer`.
 *  - `installNotificationForwarder`: notification relay end-to-end.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolResultSchema,
  ListToolsRequestSchema,
  ListToolsResultSchema,
  ResourceUpdatedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { __setEmdashDirForTests, writeTokenFile } from '../src/main/core/mcp-server/token-store';
import {
  buildMcpUrl,
  connectHttpWithRetry,
  createStdioServer,
  installNotificationForwarder,
  installPassthroughHandlers,
  resolveBridgeConfig,
} from './emdash-mcp';

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'emdash-mcp-bridge-'));
  __setEmdashDirForTests(tempDir);
});

afterEach(async () => {
  __setEmdashDirForTests(null);
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

describe('resolveBridgeConfig', () => {
  it('returns ok with the port + token from ~/.emdash/mcp.json', async () => {
    await writeTokenFile({ version: 1, port: 7457, token: 'test-token-1' });
    const result = await resolveBridgeConfig({});
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config).toEqual({ port: 7457, token: 'test-token-1' });
  });

  it('falls back to a friendly diagnostic when no token file exists', async () => {
    const result = await resolveBridgeConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    // The diagnostic must mention the file path so users know what to fix.
    expect(result.reason).toContain('mcp.json');
  });

  it('honours EMDASH_MCP_PORT when set', async () => {
    await writeTokenFile({ version: 1, port: 7457, token: 'test-token-1' });
    const result = await resolveBridgeConfig({ EMDASH_MCP_PORT: '12345' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.port).toBe(12345);
    // Token still comes from the file.
    expect(result.config.token).toBe('test-token-1');
  });

  it('rejects a non-numeric EMDASH_MCP_PORT by falling back to the file value', async () => {
    await writeTokenFile({ version: 1, port: 7457, token: 'test-token-1' });
    const result = await resolveBridgeConfig({ EMDASH_MCP_PORT: 'not-a-port' });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected ok');
    expect(result.config.port).toBe(7457);
  });

  it('rejects a port outside 1..65535', async () => {
    await writeTokenFile({ version: 1, port: 7457, token: 'test-token-1' });
    const result = await resolveBridgeConfig({ EMDASH_MCP_PORT: '70000' });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.reason).toMatch(/invalid mcp port/i);
  });

  it('rejects a malformed token file with a friendly diagnostic', async () => {
    // Write garbage directly so we bypass `writeTokenFile`'s validation.
    await writeFile(join(tempDir, 'mcp.json'), 'not valid json', 'utf8');
    const result = await resolveBridgeConfig({});
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected error');
    expect(result.reason).toContain('mcp.json');
  });
});

describe('buildMcpUrl', () => {
  it('always uses 127.0.0.1, never anything from the token file', () => {
    // Even if a future revision tried to inject a host, this signature
    // doesn't accept one — that's the security invariant we're locking in.
    const url = buildMcpUrl(7457);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.protocol).toBe('http:');
    expect(url.pathname).toBe('/mcp');
    expect(url.port).toBe('7457');
  });
});

describe('connectHttpWithRetry', () => {
  it('retries up to maxAttempts before giving up', async () => {
    // Use a port that is ~certain to refuse connections (RFC 6335 reserves
    // 1; nothing should be listening on 127.0.0.1:1 in test environments).
    const onAttempt = vi.fn();
    await expect(
      connectHttpWithRetry(
        { port: 1, token: 'irrelevant' },
        { maxAttempts: 3, initialBackoffMs: 5, onAttempt }
      )
    ).rejects.toBeInstanceOf(Error);
    // Three failed attempts should have been recorded (each with an error).
    expect(onAttempt).toHaveBeenCalledTimes(3);
    for (const call of onAttempt.mock.calls) {
      expect(call[1]).toBeInstanceOf(Error);
    }
  });
});

/**
 * Integration: wire the bridge handlers between an "upstream" stub
 * `McpServer` (using `InMemoryTransport`) and a "downstream" test `Client`
 * (also `InMemoryTransport`). The bridge is in the middle: we use a real
 * `Client` (upstream-facing) and a real `Server` (downstream-facing) and
 * call `installPassthroughHandlers` / `installNotificationForwarder` exactly
 * as `runBridge` does.
 */
describe('passthrough request handlers (in-memory end-to-end)', () => {
  it('relays tools/list and tools/call to the upstream', async () => {
    // ── 1. Upstream stub server (registers a single `echo` tool). ──
    const upstream = new McpServer({ name: 'stub-emdash', version: '0.0.0' });
    upstream.registerTool(
      'echo',
      {
        description: 'Echoes the input text back.',
        inputSchema: { text: z.string() },
      },
      async ({ text }) => ({
        content: [{ type: 'text', text }],
      })
    );

    // ── 2. Bridge's HTTP-side `Client` ↔ upstream over linked in-memory pair. ──
    const [bridgeClientTransport, upstreamServerTransport] = InMemoryTransport.createLinkedPair();
    const bridgeClient = new Client({ name: 'bridge-test', version: '1' }, { capabilities: {} });
    await Promise.all([
      bridgeClient.connect(bridgeClientTransport),
      upstream.connect(upstreamServerTransport),
    ]);

    // ── 3. Bridge's stdio-side `Server` ↔ test `Client` over a linked pair. ──
    const bridgeServer = createStdioServer();
    installPassthroughHandlers(bridgeServer, bridgeClient);

    const [downstreamClientTransport, bridgeServerTransport] = InMemoryTransport.createLinkedPair();
    const downstreamClient = new Client(
      { name: 'downstream-test', version: '1' },
      { capabilities: {} }
    );
    await Promise.all([
      bridgeServer.connect(bridgeServerTransport),
      downstreamClient.connect(downstreamClientTransport),
    ]);

    try {
      // ── 4. Drive a `tools/list` request through the bridge. ──
      const tools = await downstreamClient.request(
        { method: 'tools/list', params: {} },
        ListToolsResultSchema
      );
      expect(tools.tools.map((t) => t.name)).toContain('echo');

      // ── 5. Drive a `tools/call` request through the bridge. ──
      const callResult = await downstreamClient.request(
        {
          method: 'tools/call',
          params: { name: 'echo', arguments: { text: 'hello bridge' } },
        },
        CallToolResultSchema
      );
      expect(callResult.content?.[0]).toMatchObject({ type: 'text', text: 'hello bridge' });
    } finally {
      await Promise.allSettled([
        downstreamClient.close(),
        bridgeServer.close(),
        bridgeClient.close(),
        upstream.close(),
      ]);
    }
  });
});

describe('notification forwarder (in-memory end-to-end)', () => {
  it('relays an upstream `notifications/resources/updated` to the downstream client', async () => {
    // ── Upstream stub: a low-level `Server` so we can call `.notification` directly. ──
    // We need the low-level Server (not McpServer) because McpServer doesn't
    // expose a generic notification sender for arbitrary methods.
    const { Server: LowLevelServer } = await import('@modelcontextprotocol/sdk/server/index.js');
    const upstream = new LowLevelServer(
      { name: 'stub-emdash', version: '0.0.0' },
      {
        capabilities: {
          tools: {},
          resources: { subscribe: true, listChanged: true },
        },
      }
    );
    // The upstream needs at least one request handler so its capability set
    // is honoured by the SDK's initialize negotiation.
    upstream.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));

    // Bridge HTTP-side client ↔ upstream
    const [bridgeClientTransport, upstreamServerTransport] = InMemoryTransport.createLinkedPair();
    const bridgeClient = new Client({ name: 'bridge-test', version: '1' }, { capabilities: {} });
    await Promise.all([
      bridgeClient.connect(bridgeClientTransport),
      upstream.connect(upstreamServerTransport),
    ]);

    // Bridge stdio-side server ↔ downstream test client
    const bridgeServer = createStdioServer();
    installPassthroughHandlers(bridgeServer, bridgeClient);
    installNotificationForwarder(bridgeServer, bridgeClient);

    const [downstreamClientTransport, bridgeServerTransport] = InMemoryTransport.createLinkedPair();
    const downstreamClient = new Client(
      { name: 'downstream-test', version: '1' },
      { capabilities: {} }
    );
    await Promise.all([
      bridgeServer.connect(bridgeServerTransport),
      downstreamClient.connect(downstreamClientTransport),
    ]);

    try {
      // Capture forwarded notifications on the downstream client.
      const received: unknown[] = [];
      downstreamClient.setNotificationHandler(
        ResourceUpdatedNotificationSchema,
        async (notification) => {
          received.push(notification);
        }
      );

      // Upstream emits a notification — the bridge should forward it.
      await upstream.notification({
        method: 'notifications/resources/updated',
        params: { uri: 'emdash://tasks/abc/sessions/sess-1' },
      });

      // Allow microtasks (transport queue) to flush.
      await new Promise<void>((resolve) => setTimeout(resolve, 20));

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        method: 'notifications/resources/updated',
        params: { uri: 'emdash://tasks/abc/sessions/sess-1' },
      });
    } finally {
      await Promise.allSettled([
        downstreamClient.close(),
        bridgeServer.close(),
        bridgeClient.close(),
        upstream.close(),
      ]);
    }
  });
});
