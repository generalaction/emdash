import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMDASH_SELF_SERVER_NAME, type McpServer } from '@shared/core/mcp/types';
import type * as SelfRegistration from './server/self-registration';

const mocks = vi.hoisted(() => ({
  loadAll: vi.fn(),
  saveServer: vi.fn(),
  listForAgent: vi.fn(),
  resolveSelfServer: vi.fn(),
  getConnectionInfo: vi.fn(),
}));

vi.mock('@emdash/plugins/agents', () => ({
  pluginRegistry: { getAll: () => [] },
}));

vi.mock('@main/core/dependencies/dependency-managers', () => ({
  localDependencyManager: { get: vi.fn(), probeCategory: vi.fn() },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Keep the real isSelfServerEntry (the controller's ownership check) and mock
// only the connection-info-dependent resolveSelfServer.
vi.mock('./server/self-registration', async (importOriginal) => {
  const actual = await importOriginal<typeof SelfRegistration>();
  return { ...actual, resolveSelfServer: mocks.resolveSelfServer };
});

vi.mock('./server/mcp-http-server', () => ({
  mcpHttpServer: { getConnectionInfo: mocks.getConnectionInfo },
}));

vi.mock('./services/McpService', () => ({
  mcpService: {
    loadAll: mocks.loadAll,
    saveServer: mocks.saveServer,
    removeServer: vi.fn(),
    listForAgent: mocks.listForAgent,
  },
}));

const { mcpController } = await import('./controller');

function selfEntry(): McpServer {
  return {
    name: EMDASH_SELF_SERVER_NAME,
    transport: 'http',
    url: 'http://127.0.0.1:8212/mcp',
    headers: { Authorization: 'Bearer secret-token' },
    providers: ['claude'],
  };
}

function customServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: 'linear',
    transport: 'http',
    url: 'https://mcp.linear.app/mcp',
    headers: { Authorization: 'Bearer linear-token' },
    providers: ['claude'],
    ...overrides,
  };
}

/** A user's own server that happens to use the managed "emdash" name. */
function foreignEmdashServer(): McpServer {
  return {
    name: EMDASH_SELF_SERVER_NAME,
    transport: 'http',
    url: 'https://mcp.example.com/mcp',
    headers: { Authorization: 'Bearer user-token' },
    providers: ['claude'],
  };
}

const managedEntry = {
  key: EMDASH_SELF_SERVER_NAME,
  name: EMDASH_SELF_SERVER_NAME,
  description: 'Built-in server',
  docsUrl: '',
  defaultConfig: { type: 'http' },
  credentialKeys: [],
  managed: true,
};

const plainEntry = {
  key: 'linear',
  name: 'Linear',
  description: 'Issue tracking',
  docsUrl: 'https://linear.app',
  defaultConfig: { type: 'http', url: 'https://mcp.linear.app/mcp' },
  credentialKeys: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveServer.mockResolvedValue(undefined);
  mocks.loadAll.mockResolvedValue({ installed: [], catalog: [] });
  mocks.getConnectionInfo.mockReturnValue({
    url: 'http://127.0.0.1:8212/mcp',
    token: 'live-token',
  });
});

describe('loadAll', () => {
  it('redacts and flags the emdash entry, leaving other servers untouched', async () => {
    mocks.loadAll.mockResolvedValue({ installed: [selfEntry(), customServer()], catalog: [] });
    const result = await mcpController.loadAll();
    expect(result).toEqual({
      success: true,
      data: {
        installed: [{ ...selfEntry(), headers: undefined, managed: true }, customServer()],
        catalog: [],
      },
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('leaves an unrelated emdash-named server unredacted and unmanaged', async () => {
    mocks.loadAll.mockResolvedValue({ installed: [foreignEmdashServer()], catalog: [] });
    const result = await mcpController.loadAll();
    expect(result).toEqual({
      success: true,
      data: { installed: [foreignEmdashServer()], catalog: [] },
    });
  });

  it('fills the live url into managed catalog entries', async () => {
    mocks.loadAll.mockResolvedValue({ installed: [], catalog: [managedEntry, plainEntry] });
    const result = await mcpController.loadAll();
    expect(result).toEqual({
      success: true,
      data: {
        installed: [],
        catalog: [
          {
            ...managedEntry,
            defaultConfig: { type: 'http', url: 'http://127.0.0.1:8212/mcp' },
          },
          plainEntry,
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain('live-token');
  });

  it('omits managed catalog entries when the server is not running', async () => {
    mocks.getConnectionInfo.mockReturnValue(null);
    mocks.loadAll.mockResolvedValue({ installed: [], catalog: [managedEntry, plainEntry] });
    const result = await mcpController.loadAll();
    expect(result).toEqual({
      success: true,
      data: { installed: [], catalog: [plainEntry] },
    });
  });

  it('returns a failure result when the service throws', async () => {
    mocks.loadAll.mockRejectedValue(new Error('config unreadable'));
    const result = await mcpController.loadAll();
    expect(result).toEqual({ success: false, error: 'config unreadable' });
  });
});

describe('saveServer', () => {
  it('passes ordinary servers through unchanged', async () => {
    const server = customServer();
    const result = await mcpController.saveServer(server);
    expect(result).toEqual({ success: true });
    expect(mocks.saveServer).toHaveBeenCalledWith(server);
    expect(mocks.resolveSelfServer).not.toHaveBeenCalled();
  });

  it('replaces an emdash-named save with the resolved managed entry', async () => {
    const resolved = selfEntry();
    mocks.resolveSelfServer.mockReturnValue(resolved);
    const result = await mcpController.saveServer({
      name: EMDASH_SELF_SERVER_NAME,
      transport: 'http',
      providers: ['claude', 'codex'],
    });
    expect(result).toEqual({ success: true });
    expect(mocks.resolveSelfServer).toHaveBeenCalledWith(['claude', 'codex']);
    expect(mocks.saveServer).toHaveBeenCalledWith(resolved);
  });

  it('preserves user-set fields from the installed emdash entry', async () => {
    mocks.loadAll.mockResolvedValue({
      installed: [{ ...selfEntry(), enabled: false, timeout: 30_000 }],
      catalog: [],
    });
    mocks.resolveSelfServer.mockReturnValue(selfEntry());
    const result = await mcpController.saveServer({
      name: EMDASH_SELF_SERVER_NAME,
      transport: 'http',
      providers: ['claude'],
    });
    expect(result).toEqual({ success: true });
    expect(mocks.saveServer).toHaveBeenCalledWith({
      ...selfEntry(),
      enabled: false,
      timeout: 30_000,
    });
  });

  it('saves an unrelated emdash-named server as-is instead of hijacking it', async () => {
    mocks.loadAll.mockResolvedValue({ installed: [foreignEmdashServer()], catalog: [] });
    const edited = { ...foreignEmdashServer(), providers: ['claude', 'codex'] };
    const result = await mcpController.saveServer(edited);
    expect(result).toEqual({ success: true });
    expect(mocks.saveServer).toHaveBeenCalledWith(edited);
    expect(mocks.resolveSelfServer).not.toHaveBeenCalled();
  });

  it('fails without writing when the emdash server is not running', async () => {
    mocks.resolveSelfServer.mockImplementation(() => {
      throw new Error('The emdash MCP server is not running');
    });
    const result = await mcpController.saveServer({
      name: EMDASH_SELF_SERVER_NAME,
      transport: 'http',
      providers: ['claude'],
    });
    expect(result).toEqual({ success: false, error: 'The emdash MCP server is not running' });
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });
});

describe('listForAgent', () => {
  it('redacts and flags the emdash entry, leaving other servers untouched', async () => {
    mocks.listForAgent.mockResolvedValue([selfEntry(), customServer()]);
    const result = await mcpController.listForAgent('claude');
    expect(result).toEqual({
      success: true,
      data: [{ ...selfEntry(), headers: undefined, managed: true }, customServer()],
    });
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });
});
