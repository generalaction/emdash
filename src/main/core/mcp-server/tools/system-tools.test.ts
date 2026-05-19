/**
 * Unit tests for the `system.*` MCP tools.
 *
 * Same fake-server + injected-deps pattern as `task-tools.test.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetSystemDeps, _setSystemDeps, registerSystemTools } from './system-tools';

type CapturedHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

interface TestServer extends Pick<McpServer, 'registerTool'> {
  handlers: Map<string, CapturedHandler>;
}

function makeTestServer(): TestServer {
  const handlers = new Map<string, CapturedHandler>();
  const server: TestServer = {
    handlers,
    registerTool: ((name: string, _config: unknown, handler: CapturedHandler) => {
      handlers.set(name, handler);
      return { remove: () => undefined } as never;
    }) as McpServer['registerTool'],
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
  checkInstalledApps: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    checkInstalledApps: vi.fn().mockResolvedValue({}),
  };
}

function installMockDeps(m: MockDeps): void {
  _setSystemDeps({
    appService: {
      checkInstalledApps: m.checkInstalledApps,
    },
  } as unknown as Parameters<typeof _setSystemDeps>[0]);
}

describe('system-tools', () => {
  let server: TestServer;
  let deps: MockDeps;

  beforeEach(() => {
    server = makeTestServer();
    registerSystemTools(server as unknown as McpServer);
    deps = makeMockDeps();
    installMockDeps(deps);
  });

  afterEach(() => {
    _resetSystemDeps();
    vi.clearAllMocks();
  });

  it('registers the expected tool catalogue under system.* names', () => {
    expect([...server.handlers.keys()].sort()).toEqual(['system.health', 'system.listEditors']);
  });

  describe('system.health', () => {
    it('returns the canonical shape: { name, version, uptimeMs, recentErrorCount }', async () => {
      const handler = server.handlers.get('system.health')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: {
          name: string;
          version: string;
          uptimeMs: number;
          recentErrorCount: number;
        };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.name).toBe('emdash');
      expect(typeof parsed.payload.version).toBe('string');
      expect(parsed.payload.version.length).toBeGreaterThan(0);
      expect(typeof parsed.payload.uptimeMs).toBe('number');
      expect(parsed.payload.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(typeof parsed.payload.recentErrorCount).toBe('number');
      expect(parsed.payload.recentErrorCount).toBeGreaterThanOrEqual(0);
    });
  });

  describe('system.listEditors', () => {
    it('returns the detected-editor availability map from appService', async () => {
      deps.checkInstalledApps.mockResolvedValue({
        vscode: true,
        cursor: false,
        zed: true,
      });
      const handler = server.handlers.get('system.listEditors')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: Record<string, boolean>;
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload).toEqual({ vscode: true, cursor: false, zed: true });
      expect(deps.checkInstalledApps).toHaveBeenCalledTimes(1);
    });

    it('falls back to the static catalog when checkInstalledApps throws', async () => {
      deps.checkInstalledApps.mockRejectedValue(new Error('not in electron'));
      const handler = server.handlers.get('system.listEditors')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: Record<string, boolean>;
      };
      expect(parsed.isError).toBe(false);
      // All entries should be present and false in the fallback.
      const values = Object.values(parsed.payload);
      expect(values.length).toBeGreaterThan(0);
      for (const v of values) {
        expect(v).toBe(false);
      }
    });
  });
});
