import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMcpMeta, ServerMap } from '@shared/mcp/types';
import * as configIO from '../utils/config-io';
import * as configPaths from '../utils/config-paths';
import { McpService } from './McpService';

vi.mock('../utils/config-io', () => ({
  readServers: vi.fn(),
  writeServers: vi.fn(),
}));

vi.mock('../utils/config-paths', () => ({
  getAgentMcpMeta: vi.fn(),
  getAllMcpAgentIds: vi.fn(() => ['claude', 'cursor']),
}));

vi.mock('../utils/catalog', () => ({
  loadCatalog: vi.fn(() => []),
  getCatalogServerConfig: vi.fn(),
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

const mockReadServers = vi.mocked(configIO.readServers);
const mockWriteServers = vi.mocked(configIO.writeServers);
const mockGetMeta = vi.mocked(configPaths.getAgentMcpMeta);

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

describe('McpService', () => {
  let service: McpService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new McpService();
    mockGetMeta.mockImplementation((id: string) => {
      if (id === 'claude') return claudeMeta;
      if (id === 'cursor') return cursorMeta;
      return undefined;
    });
  });

  describe('loadAll', () => {
    it('reads servers from all agents and normalizes to McpServer[]', async () => {
      mockReadServers
        .mockResolvedValueOnce({ myServer: { command: 'npx', args: ['-y', 'foo'] } }) // claude
        .mockResolvedValueOnce({}); // cursor

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

      // Save with only cursor selected — should remove from claude
      await service.saveServer({
        name: 'myServer',
        transport: 'stdio',
        command: 'npx',
        args: [],

        providers: ['cursor'],
      });

      // Claude should have myServer removed
      const claudeCall = mockWriteServers.mock.calls.find((c) => c[0] === claudeMeta);
      if (claudeCall) {
        expect((claudeCall[1] as ServerMap).myServer).toBeUndefined();
      }
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
  });
});
