/**
 * Unit tests for the `worktree.*` MCP tools.
 *
 * Same fake-server + injected-deps pattern as `task-tools.test.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetWorktreeDeps, _setWorktreeDeps, registerWorktreeTools } from './worktree-tools';

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
  wsGet: ReturnType<typeof vi.fn>;
  appOpenIn: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    wsGet: vi.fn(),
    appOpenIn: vi.fn().mockResolvedValue(undefined),
  };
}

function installMockDeps(m: MockDeps): void {
  _setWorktreeDeps({
    workspaceRegistry: {
      get: m.wsGet,
    },
    appService: {
      openIn: m.appOpenIn,
    },
  } as unknown as Parameters<typeof _setWorktreeDeps>[0]);
}

describe('worktree-tools', () => {
  let server: TestServer;
  let deps: MockDeps;

  beforeEach(() => {
    server = makeTestServer();
    registerWorktreeTools(server as unknown as McpServer);
    deps = makeMockDeps();
    installMockDeps(deps);
  });

  afterEach(() => {
    _resetWorktreeDeps();
    vi.clearAllMocks();
  });

  it('registers the expected tool catalogue under worktree.* names', () => {
    expect([...server.handlers.keys()].sort()).toEqual(['worktree.openInIDE']);
  });

  describe('worktree.openInIDE', () => {
    it('happy path → resolves the workspace and opens it in the editor', async () => {
      deps.wsGet.mockReturnValue({ path: '/tmp/worktrees/abc' });

      const handler = server.handlers.get('worktree.openInIDE')!;
      const reply = await handler({ workspaceId: 'ws-1', editor: 'cursor' });

      expect(deps.wsGet).toHaveBeenCalledWith('ws-1');
      expect(deps.appOpenIn).toHaveBeenCalledWith({ app: 'cursor', path: '/tmp/worktrees/abc' });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { workspaceId: string; editor: string; path: string };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload).toEqual({
        workspaceId: 'ws-1',
        editor: 'cursor',
        path: '/tmp/worktrees/abc',
      });
    });

    it('returns WORKSPACE_NOT_READY when the workspace is not mounted', async () => {
      deps.wsGet.mockReturnValue(undefined);

      const handler = server.handlers.get('worktree.openInIDE')!;
      const reply = await handler({ workspaceId: 'missing', editor: 'vscode' });

      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('WORKSPACE_NOT_READY');
      expect(deps.appOpenIn).not.toHaveBeenCalled();
    });
  });
});
