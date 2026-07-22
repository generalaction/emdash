import type { McpServer } from '@emdash/core/mcp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EMDASH_SELF_SERVER_NAME } from '@shared/core/mcp/types';

const mocks = vi.hoisted(() => ({
  loadAll: vi.fn(),
  saveServer: vi.fn(),
  getConnectionInfo: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../services/McpService', () => ({
  mcpService: { loadAll: mocks.loadAll, saveServer: mocks.saveServer },
}));

vi.mock('./mcp-http-server', () => ({
  mcpHttpServer: { getConnectionInfo: mocks.getConnectionInfo },
}));

vi.mock('@main/lib/logger', () => ({
  log: { info: vi.fn(), warn: mocks.warn, error: vi.fn() },
}));

const { refreshSelfServerRegistration, resolveSelfServer } = await import('./self-registration');

const RUNNING = { url: 'http://127.0.0.1:8212/mcp', token: 'token-1' };

function selfEntry(overrides: Partial<McpServer> = {}): McpServer {
  return {
    name: EMDASH_SELF_SERVER_NAME,
    transport: 'http',
    url: 'http://127.0.0.1:9999/mcp',
    headers: { Authorization: 'Bearer stale-token' },
    providers: ['claude', 'codex'],
    ...overrides,
  };
}

function installServers(servers: McpServer[]): void {
  mocks.loadAll.mockResolvedValue({ installed: servers });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getConnectionInfo.mockReturnValue(RUNNING);
  mocks.saveServer.mockResolvedValue(undefined);
  installServers([]);
});

describe('resolveSelfServer', () => {
  it('throws when the http server is not running', () => {
    mocks.getConnectionInfo.mockReturnValue(null);
    expect(() => resolveSelfServer(['claude'])).toThrow('The emdash MCP server is not running');
  });

  it('builds the entry from the live url, bearer token, and given providers', () => {
    expect(resolveSelfServer(['claude'])).toEqual({
      name: EMDASH_SELF_SERVER_NAME,
      transport: 'http',
      url: RUNNING.url,
      headers: { Authorization: `Bearer ${RUNNING.token}` },
      providers: ['claude'],
    });
  });
});

describe('refreshSelfServerRegistration', () => {
  it('does nothing when the http server is not running', async () => {
    mocks.getConnectionInfo.mockReturnValue(null);
    installServers([selfEntry()]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });

  it('does nothing when emdash is not registered in any agent config', async () => {
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });

  it('does nothing when the entry has no providers', async () => {
    installServers([selfEntry({ providers: [] })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });

  it('rewrites a loopback entry with the current url and token, keeping its providers', async () => {
    installServers([selfEntry()]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).toHaveBeenCalledWith({
      name: EMDASH_SELF_SERVER_NAME,
      transport: 'http',
      url: RUNNING.url,
      headers: { Authorization: `Bearer ${RUNNING.token}` },
      providers: ['claude', 'codex'],
    });
  });

  it('preserves user-set fields (enabled, timeout) when rewriting', async () => {
    installServers([selfEntry({ enabled: false, timeout: 30_000 })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).toHaveBeenCalledWith({
      name: EMDASH_SELF_SERVER_NAME,
      transport: 'http',
      url: RUNNING.url,
      headers: { Authorization: `Bearer ${RUNNING.token}` },
      providers: ['claude', 'codex'],
      enabled: false,
      timeout: 30_000,
    });
  });

  it.each(['localhost', '[::1]'])('treats a %s entry as its own', async (host) => {
    installServers([selfEntry({ url: `http://${host}:8212/mcp` })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).toHaveBeenCalledTimes(1);
  });

  it('leaves an unrelated server named "emdash" on a non-local host untouched', async () => {
    installServers([selfEntry({ url: 'https://mcp.example.com/mcp' })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalled();
  });

  it('leaves a loopback server on a different path untouched', async () => {
    installServers([selfEntry({ url: 'http://127.0.0.1:3000/api/mcp' })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });

  it('leaves an entry without a url untouched', async () => {
    installServers([selfEntry({ url: undefined })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });

  it('leaves an entry with an unparseable url untouched', async () => {
    installServers([selfEntry({ url: 'not a url' })]);
    await refreshSelfServerRegistration();
    expect(mocks.saveServer).not.toHaveBeenCalled();
  });
});
