import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../main/services/mcp/configIO', () => ({
  readServers: vi.fn(),
  writeServers: vi.fn(),
}));

vi.mock('../../../main/services/mcp/configPaths', () => ({
  getAgentMcpMeta: vi.fn(),
  getAllMcpAgentIds: vi.fn(() => ['claude', 'cursor']),
}));

vi.mock('../../../main/services/mcp/catalog', () => ({
  loadCatalog: vi.fn(() => []),
  getCatalogServerConfig: vi.fn(),
}));

vi.mock('../../../main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import { McpService } from '../../../main/services/McpService';
import * as configIO from '../../../main/services/mcp/configIO';
import * as configPaths from '../../../main/services/mcp/configPaths';
import type { AgentMcpMeta, ServerMap } from '@shared/mcp/types';

const mockReadServers = vi.mocked(configIO.readServers);
const mockWriteServers = vi.mocked(configIO.writeServers);
const mockGetMeta = vi.mocked(configPaths.getAgentMcpMeta);
const mockGetAllAgentIds = vi.mocked(configPaths.getAllMcpAgentIds);

const claudeMeta: AgentMcpMeta = {
  agentId: 'claude',
  configPath: '/home/test/.claude.json',
  serversPath: ['mcpServers'],
  template: { mcpServers: {} },
  isToml: false,
  adapter: 'passthrough',
};

const cursorMeta: AgentMcpMeta = {
  agentId: 'cursor',
  configPath: '/home/test/.cursor/mcp.json',
  serversPath: ['mcpServers'],
  template: { mcpServers: {} },
  isToml: false,
  adapter: 'cursor',
};

const opencodeMeta: AgentMcpMeta = {
  agentId: 'opencode',
  configPath: '/home/test/.config/opencode/opencode.json',
  serversPath: ['mcp'],
  template: { mcp: {} },
  isToml: false,
  isJsonc: true,
  adapter: 'opencode',
};

describe('McpService', () => {
  let service: McpService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new McpService();
    mockGetAllAgentIds.mockReturnValue(['claude', 'cursor']);
    mockGetMeta.mockImplementation((id: string) => {
      if (id === 'claude') return claudeMeta;
      if (id === 'cursor') return cursorMeta;
      if (id === 'opencode') return opencodeMeta;
      return undefined;
    });
  });

  describe('loadAll', () => {
    it('reads servers from all agents and normalizes to McpServer[]', async () => {
      mockReadServers
        .mockResolvedValueOnce({ myServer: { command: 'npx', args: ['-y', 'foo'] } })
        .mockResolvedValueOnce({});

      const result = await service.loadAll();
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0].name).toBe('myServer');
      expect(result.installed[0].transport).toBe('stdio');
      expect(result.installed[0].providers).toContain('claude');
    });

    it('deduplicates servers by name, merging providers', async () => {
      mockReadServers
        .mockResolvedValueOnce({ shared: { command: 'npx', args: ['foo'] } })
        .mockResolvedValueOnce({ shared: { command: 'npx', args: ['foo'] } });

      const result = await service.loadAll();
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0].providers).toContain('claude');
      expect(result.installed[0].providers).toContain('cursor');
    });

    it('skips agents that throw on read', async () => {
      mockReadServers
        .mockRejectedValueOnce(new Error('malformed'))
        .mockResolvedValueOnce({ s1: { command: 'npx' } });

      const result = await service.loadAll();
      expect(result.installed).toHaveLength(1);
    });
  });

  describe('saveServer', () => {
    it('writes to selected providers using forward adapters', async () => {
      mockReadServers.mockImplementation(() => Promise.resolve({}));
      mockWriteServers.mockResolvedValue(undefined);

      await service.saveServer({
        name: 'myServer',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'foo'],
        providers: ['claude'],
      });

      expect(mockWriteServers).toHaveBeenCalledTimes(1);
      expect(mockWriteServers.mock.calls[0][0]).toBe(claudeMeta);
      const written = mockWriteServers.mock.calls[0][1] as ServerMap;
      expect(written.myServer).toBeDefined();
    });

    it('removes server from deselected providers', async () => {
      mockReadServers.mockImplementation(() =>
        Promise.resolve({ myServer: { command: 'npx' }, other: { command: 'y' } })
      );
      mockWriteServers.mockResolvedValue(undefined);

      await service.saveServer({
        name: 'myServer',
        transport: 'stdio',
        command: 'npx',
        args: [],
        providers: ['cursor'],
      });

      const claudeCall = mockWriteServers.mock.calls.find((c) => c[0] === claudeMeta);
      if (claudeCall) {
        expect((claudeCall[1] as ServerMap).myServer).toBeUndefined();
      }
    });

    it('fails without writing when opencode read fails during a multi-provider save', async () => {
      mockGetAllAgentIds.mockReturnValue(['claude', 'cursor', 'opencode']);
      mockReadServers.mockImplementation((meta) => {
        if (meta.agentId === 'opencode') {
          return Promise.reject(new Error('unsafe parse'));
        }
        return Promise.resolve({ keep: { command: 'y' } });
      });
      mockWriteServers.mockResolvedValue(undefined);

      await expect(
        service.saveServer({
          name: 'myServer',
          transport: 'stdio',
          command: 'npx',
          providers: ['claude', 'opencode'],
        })
      ).rejects.toThrow('Failed to read config for: opencode');
      expect(mockWriteServers).not.toHaveBeenCalled();
    });

    it('reports write failures separately from read failures', async () => {
      mockGetAllAgentIds.mockReturnValue(['claude']);
      mockReadServers.mockResolvedValue({});
      mockWriteServers.mockRejectedValue(new Error('disk full'));

      await expect(
        service.saveServer({
          name: 'myServer',
          transport: 'stdio',
          command: 'npx',
          providers: ['claude'],
        })
      ).rejects.toThrow('Failed to write config for: claude');
    });

    it('rejects empty server name', async () => {
      await expect(
        service.saveServer({
          name: '',
          transport: 'stdio',
          command: 'npx',
          providers: ['claude'],
        })
      ).rejects.toThrow('Invalid server name');
    });

    it('rejects server name with invalid characters', async () => {
      await expect(
        service.saveServer({
          name: 'my server/hack',
          transport: 'stdio',
          command: 'npx',
          providers: ['claude'],
        })
      ).rejects.toThrow('Invalid server name');
    });
  });

  describe('removeServer', () => {
    it('removes server from all agent configs', async () => {
      mockReadServers.mockImplementation(() =>
        Promise.resolve({ toRemove: { command: 'npx' }, keep: { command: 'y' } })
      );
      mockWriteServers.mockResolvedValue(undefined);

      await service.removeServer('toRemove');

      for (const call of mockWriteServers.mock.calls) {
        const servers = call[1] as ServerMap;
        expect(servers.toRemove).toBeUndefined();
        expect(servers.keep).toBeDefined();
      }
    });

    it('fails without writing when opencode read fails during a multi-provider remove', async () => {
      mockGetAllAgentIds.mockReturnValue(['claude', 'cursor', 'opencode']);
      mockReadServers.mockImplementation((meta) => {
        if (meta.agentId === 'opencode') {
          return Promise.reject(new Error('unsafe parse'));
        }
        if (meta.agentId === 'claude') {
          return Promise.resolve({ toRemove: { command: 'npx' }, keep: { command: 'y' } });
        }
        return Promise.resolve({ keep: { command: 'y' } });
      });
      mockWriteServers.mockResolvedValue(undefined);

      await expect(service.removeServer('toRemove')).rejects.toThrow(
        'Failed to read config for: opencode'
      );
      expect(mockWriteServers).not.toHaveBeenCalled();
    });
  });
});
