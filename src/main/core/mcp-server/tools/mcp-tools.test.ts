/**
 * Unit tests for the `mcp.*` MCP tools (managing emdash's outbound MCP
 * server config).
 */
import type { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServer } from '@shared/mcp/types';
import { _resetMcpDeps, _setMcpDeps, registerMcpTools } from './mcp-tools';

type CapturedHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

interface TestServer extends Pick<SdkMcpServer, 'registerTool'> {
  handlers: Map<string, CapturedHandler>;
}

function makeTestServer(): TestServer {
  const handlers = new Map<string, CapturedHandler>();
  const server: TestServer = {
    handlers,
    registerTool: ((name: string, _config: unknown, handler: CapturedHandler) => {
      handlers.set(name, handler);
      return { remove: () => undefined } as never;
    }) as SdkMcpServer['registerTool'],
  };
  return server;
}

function parseReply(reply: unknown): { isError: boolean; payload: unknown } {
  const r = reply as {
    isError?: boolean;
    content: Array<{ type: 'text'; text: string }>;
  };
  return {
    isError: r.isError === true,
    payload: JSON.parse(r.content[0].text) as unknown,
  };
}

interface MockDeps {
  loadAll: ReturnType<typeof vi.fn>;
  saveServer: ReturnType<typeof vi.fn>;
  removeServer: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    loadAll: vi.fn().mockResolvedValue({ installed: [], catalog: [] }),
    saveServer: vi.fn().mockResolvedValue(undefined),
    removeServer: vi.fn().mockResolvedValue(undefined),
  };
}

function installMockDeps(m: MockDeps): void {
  _setMcpDeps({
    mcpService: {
      loadAll: m.loadAll,
      saveServer: m.saveServer,
      removeServer: m.removeServer,
    },
  } as unknown as Parameters<typeof _setMcpDeps>[0]);
}

describe('mcp-tools', () => {
  let server: TestServer;
  let deps: MockDeps;

  beforeEach(() => {
    server = makeTestServer();
    registerMcpTools(server as unknown as SdkMcpServer);
    deps = makeMockDeps();
    installMockDeps(deps);
  });

  afterEach(() => {
    _resetMcpDeps();
    vi.clearAllMocks();
  });

  it('registers the expected tool catalogue under mcp.* names', () => {
    expect([...server.handlers.keys()].sort()).toEqual(['mcp.add', 'mcp.list', 'mcp.remove']);
  });

  describe('mcp.list', () => {
    it('returns the full installed + catalog payload by default', async () => {
      const installedA: McpServer = {
        name: 'a',
        transport: 'stdio',
        command: 'a',
        providers: ['claude-code'],
      };
      const installedB: McpServer = {
        name: 'b',
        transport: 'http',
        url: 'http://x',
        providers: ['cursor'],
      };
      deps.loadAll.mockResolvedValue({ installed: [installedA, installedB], catalog: [] });
      const handler = server.handlers.get('mcp.list')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { installed: McpServer[] };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.installed).toHaveLength(2);
    });

    it('filters by provider when one is given', async () => {
      const installedA: McpServer = {
        name: 'a',
        transport: 'stdio',
        command: 'a',
        providers: ['claude-code'],
      };
      const installedB: McpServer = {
        name: 'b',
        transport: 'http',
        url: 'http://x',
        providers: ['cursor'],
      };
      deps.loadAll.mockResolvedValue({ installed: [installedA, installedB], catalog: [] });
      const handler = server.handlers.get('mcp.list')!;
      const reply = await handler({ provider: 'cursor' });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { installed: McpServer[] };
      };
      expect(parsed.payload.installed.map((s) => s.name)).toEqual(['b']);
    });
  });

  describe('mcp.add', () => {
    it('passes the canonical McpServer shape to saveServer', async () => {
      const handler = server.handlers.get('mcp.add')!;
      const reply = await handler({
        name: 'linear',
        transport: 'stdio',
        command: 'linear-mcp',
        args: ['--debug'],
        env: { TOKEN: 'x' },
        providers: ['claude-code', 'cursor'],
      });
      expect(deps.saveServer).toHaveBeenCalledTimes(1);
      const saved = deps.saveServer.mock.calls[0]![0] as McpServer;
      expect(saved.name).toBe('linear');
      expect(saved.transport).toBe('stdio');
      expect(saved.command).toBe('linear-mcp');
      expect(saved.providers).toEqual(['claude-code', 'cursor']);
      expect(parseReply(reply).isError).toBe(false);
    });

    it('surfaces UNHANDLED when the service throws', async () => {
      deps.saveServer.mockRejectedValue(new Error('config write failed'));
      const handler = server.handlers.get('mcp.add')!;
      const reply = await handler({
        name: 'broken',
        transport: 'stdio',
        command: 'x',
        providers: ['claude-code'],
      });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { code: string; message: string };
      };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('UNHANDLED');
      expect(parsed.payload.message).toContain('config write failed');
    });
  });

  describe('mcp.remove', () => {
    it('without confirm returns CONFIRM_REQUIRED and does not call removeServer', async () => {
      const handler = server.handlers.get('mcp.remove')!;
      const reply = await handler({ name: 'linear' });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('CONFIRM_REQUIRED');
      expect(deps.removeServer).not.toHaveBeenCalled();
    });

    it('with confirm: true calls removeServer(name)', async () => {
      const handler = server.handlers.get('mcp.remove')!;
      const reply = await handler({ name: 'linear', confirm: true });
      expect(deps.removeServer).toHaveBeenCalledWith('linear');
      expect(parseReply(reply).isError).toBe(false);
    });
  });
});
