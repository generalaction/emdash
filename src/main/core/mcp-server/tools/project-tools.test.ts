/**
 * Unit tests for the `project.*` MCP tools.
 *
 * Same fake-server + injected-deps pattern as `task-tools.test.ts`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { _resetProjectDeps, _setProjectDeps, registerProjectTools } from './project-tools';

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
  createProject: ReturnType<typeof vi.fn>;
  getProjects: ReturnType<typeof vi.fn>;
  getProjectById: ReturnType<typeof vi.fn>;
  deleteProject: ReturnType<typeof vi.fn>;
  pmGetProject: ReturnType<typeof vi.fn>;
  settingsGet: ReturnType<typeof vi.fn>;
  getRemoteState: ReturnType<typeof vi.fn>;
  updateProjectSettings: ReturnType<typeof vi.fn>;
}

function makeMockDeps(): MockDeps {
  return {
    createProject: vi.fn(),
    getProjects: vi.fn().mockResolvedValue([]),
    getProjectById: vi.fn().mockResolvedValue(undefined),
    deleteProject: vi.fn().mockResolvedValue(undefined),
    pmGetProject: vi.fn().mockReturnValue(undefined),
    settingsGet: vi.fn().mockResolvedValue({}),
    getRemoteState: vi.fn().mockResolvedValue({ hasRemote: false, selectedRemoteUrl: null }),
    updateProjectSettings: vi.fn(),
  };
}

function installMockDeps(m: MockDeps): void {
  _setProjectDeps({
    createProject: m.createProject,
    getProjects: m.getProjects,
    getProjectById: m.getProjectById,
    deleteProject: m.deleteProject,
    projectManager: {
      getProject: (id: string) => {
        const provider = (m.pmGetProject as (id: string) => unknown)(id);
        return provider;
      },
    },
    projectSettingsService: {
      updateProjectSettings: m.updateProjectSettings,
    },
  } as unknown as Parameters<typeof _setProjectDeps>[0]);
}

describe('project-tools', () => {
  let server: TestServer;
  let deps: MockDeps;

  beforeEach(() => {
    server = makeTestServer();
    registerProjectTools(server as unknown as McpServer);
    deps = makeMockDeps();
    installMockDeps(deps);
  });

  afterEach(() => {
    _resetProjectDeps();
    vi.clearAllMocks();
  });

  it('registers the expected tool catalogue under project.* names', () => {
    expect([...server.handlers.keys()].sort()).toEqual([
      'project.add',
      'project.delete',
      'project.get',
      'project.list',
      'project.updateSettings',
    ]);
  });

  describe('project.add', () => {
    it('with path → creates a local project', async () => {
      deps.createProject.mockResolvedValue({
        type: 'local',
        id: 'p1',
        name: 'my-repo',
        path: '/tmp/my-repo',
        baseRef: 'main',
        createdAt: 't',
        updatedAt: 't',
      });
      const handler = server.handlers.get('project.add')!;
      const reply = await handler({ path: '/tmp/my-repo' });
      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
      const call = deps.createProject.mock.calls[0]![0] as { type: string; name: string };
      expect(call.type).toBe('local');
      expect(call.name).toBe('my-repo');
    });

    it('with ssh → creates an SSH project using the connectionId', async () => {
      deps.createProject.mockResolvedValue({
        type: 'ssh',
        id: 'p2',
        name: 'remote-repo',
        path: '/srv/remote-repo',
        baseRef: 'main',
        connectionId: 'conn-1',
        createdAt: 't',
        updatedAt: 't',
      });
      const handler = server.handlers.get('project.add')!;
      const reply = await handler({
        ssh: { connectionId: 'conn-1', remotePath: '/srv/remote-repo' },
      });
      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
      const call = deps.createProject.mock.calls[0]![0] as {
        type: string;
        connectionId: string;
        path: string;
      };
      expect(call.type).toBe('ssh');
      expect(call.connectionId).toBe('conn-1');
      expect(call.path).toBe('/srv/remote-repo');
    });

    it('rejects when both path and ssh are provided', async () => {
      const handler = server.handlers.get('project.add')!;
      const reply = await handler({
        path: '/tmp/x',
        ssh: { connectionId: 'c', remotePath: '/srv/x' },
      });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('INVALID_ARGS');
      expect(deps.createProject).not.toHaveBeenCalled();
    });

    it('rejects when neither path nor ssh is provided', async () => {
      const handler = server.handlers.get('project.add')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('INVALID_ARGS');
    });
  });

  describe('project.list', () => {
    it('returns the persisted project list', async () => {
      deps.getProjects.mockResolvedValue([
        { type: 'local', id: 'p1', name: 'a', path: '/a', baseRef: 'main' },
      ]);
      const handler = server.handlers.get('project.list')!;
      const reply = await handler({});
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: Array<{ id: string }>;
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload).toHaveLength(1);
      expect(parsed.payload[0].id).toBe('p1');
    });
  });

  describe('project.get', () => {
    it('returns project + settings + remotes when the project is mounted', async () => {
      const project = {
        type: 'local' as const,
        id: 'p1',
        name: 'a',
        path: '/a',
        baseRef: 'main',
        createdAt: 't',
        updatedAt: 't',
      };
      deps.getProjectById.mockResolvedValue(project);
      deps.pmGetProject.mockReturnValue({
        settings: { get: deps.settingsGet },
        getRemoteState: deps.getRemoteState,
      });
      deps.settingsGet.mockResolvedValue({ worktreeDirectory: '.worktrees' });
      deps.getRemoteState.mockResolvedValue({
        hasRemote: true,
        selectedRemoteUrl: 'git@github.com:x/y.git',
      });
      const handler = server.handlers.get('project.get')!;
      const reply = await handler({ projectId: 'p1' });
      const parsed = parseReply(reply) as {
        isError: boolean;
        payload: { project: { id: string }; settings: unknown; remotes: unknown };
      };
      expect(parsed.isError).toBe(false);
      expect(parsed.payload.project.id).toBe('p1');
      expect(parsed.payload.settings).toEqual({ worktreeDirectory: '.worktrees' });
      expect(parsed.payload.remotes).toEqual({
        hasRemote: true,
        selectedRemoteUrl: 'git@github.com:x/y.git',
      });
    });

    it('returns NOT_FOUND when the project does not exist', async () => {
      deps.getProjectById.mockResolvedValue(undefined);
      const handler = server.handlers.get('project.get')!;
      const reply = await handler({ projectId: 'missing' });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_FOUND');
    });
  });

  describe('project.updateSettings', () => {
    it('merges the patch into current settings and calls the service', async () => {
      deps.pmGetProject.mockReturnValue({
        settings: { get: deps.settingsGet },
        getRemoteState: deps.getRemoteState,
      });
      deps.settingsGet.mockResolvedValue({ worktreeDirectory: 'old', tmux: false });
      deps.updateProjectSettings.mockResolvedValue(ok({ worktreeDirectory: 'new', tmux: true }));
      const handler = server.handlers.get('project.updateSettings')!;
      const reply = await handler({
        projectId: 'p1',
        patch: { worktreeDirectory: 'new', tmux: true },
      });
      expect(deps.updateProjectSettings).toHaveBeenCalledTimes(1);
      const [projectId, merged] = deps.updateProjectSettings.mock.calls[0]!;
      expect(projectId).toBe('p1');
      expect(merged).toMatchObject({ worktreeDirectory: 'new', tmux: true });
      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
    });

    it('returns NOT_FOUND when the project is not mounted', async () => {
      deps.pmGetProject.mockReturnValue(undefined);
      const handler = server.handlers.get('project.updateSettings')!;
      const reply = await handler({
        projectId: 'missing',
        patch: { worktreeDirectory: 'x' },
      });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_FOUND');
      expect(deps.updateProjectSettings).not.toHaveBeenCalled();
    });
  });

  describe('project.delete', () => {
    it('without confirm returns CONFIRM_REQUIRED and does not call deleteProject', async () => {
      const handler = server.handlers.get('project.delete')!;
      const reply = await handler({ projectId: 'p1' });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('CONFIRM_REQUIRED');
      expect(deps.deleteProject).not.toHaveBeenCalled();
    });

    it('with confirm: true on a known project deletes it', async () => {
      deps.getProjectById.mockResolvedValue({
        type: 'local',
        id: 'p1',
        name: 'a',
        path: '/a',
        baseRef: 'main',
        createdAt: 't',
        updatedAt: 't',
      });
      const handler = server.handlers.get('project.delete')!;
      const reply = await handler({ projectId: 'p1', confirm: true });
      expect(deps.deleteProject).toHaveBeenCalledWith('p1');
      const parsed = parseReply(reply);
      expect(parsed.isError).toBe(false);
    });

    it('with confirm: true on an unknown project returns NOT_FOUND', async () => {
      deps.getProjectById.mockResolvedValue(undefined);
      const handler = server.handlers.get('project.delete')!;
      const reply = await handler({ projectId: 'missing', confirm: true });
      const parsed = parseReply(reply) as { isError: boolean; payload: { code: string } };
      expect(parsed.isError).toBe(true);
      expect(parsed.payload.code).toBe('NOT_FOUND');
      expect(deps.deleteProject).not.toHaveBeenCalled();
    });
  });
});
