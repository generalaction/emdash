import type { McpServerRegistration, PluginFs } from '@emdash/core/agents/plugins';
import type { McpServer } from '@emdash/core/mcp';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpService as McpServiceType } from './McpService';

// ── In-memory PluginFs ───────────────────────────────────────────────────────

function createMemoryFs(initial: Record<string, string> = {}): PluginFs {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async read(path: string) {
      return store.get(path) ?? null;
    },
    async write(path: string, content: string) {
      store.set(path, content);
    },
    async delete(path: string) {
      store.delete(path);
    },
    async exists(path: string) {
      return store.has(path);
    },
    async list(_path: string) {
      return [];
    },
  };
}

// ── Fake plugin registry ─────────────────────────────────────────────────────

type FakeMcpBehavior = {
  readServers: (fs: PluginFs) => Promise<McpServerRegistration[]>;
  writeServers: (fs: PluginFs, servers: McpServerRegistration[]) => Promise<void>;
  removeServer: (fs: PluginFs, name: string) => Promise<void>;
};

function fakeMcpBehavior(configPath: string): FakeMcpBehavior {
  return {
    async readServers(fs) {
      const content = await fs.read(configPath);
      if (!content) return [];
      const parsed = JSON.parse(content) as Record<string, unknown>;
      const mcpServers = (parsed.mcpServers ?? {}) as Record<string, Record<string, unknown>>;
      return Object.entries(mcpServers).map(
        ([name, raw]) => ({ name, ...raw }) as McpServerRegistration
      );
    },
    async writeServers(fs, servers) {
      const content = await fs.read(configPath);
      const parsed = content ? (JSON.parse(content) as Record<string, unknown>) : {};
      parsed.mcpServers = Object.fromEntries(servers.map(({ name, ...rest }) => [name, rest]));
      await fs.write(configPath, JSON.stringify(parsed, null, 2));
    },
    async removeServer(fs, name) {
      const servers = await this.readServers(fs);
      await this.writeServers(
        fs,
        servers.filter((s) => s.name !== name)
      );
    },
  };
}

function fakeProvider(id: string, configPath: string) {
  return {
    metadata: { id, name: id, description: '', websiteUrl: '' },
    capabilities: {
      mcp: { kind: 'supported' as const, supportedTransports: ['stdio', 'http'] as const },
    },
    behavior: { mcp: fakeMcpBehavior(configPath) },
  };
}

function jsonResponse(payload: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(payload), init);
}

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockProviders: ReturnType<typeof fakeProvider>[] = [];

vi.mock('@emdash/plugins/agents', () => ({
  pluginRegistry: {
    getAll: () => mockProviders,
    get: (id: string) => mockProviders.find((p) => p.metadata.id === id),
  },
}));

let mockFs: PluginFs;

vi.mock('@main/core/agents/plugin-fs', () => ({
  createPluginFs: () => mockFs,
}));

vi.mock('../utils/catalog', () => ({
  loadCatalog: vi.fn(() => []),
}));

vi.mock('@main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Tests ────────────────────────────────────────────────────────────────────

describe('McpService', () => {
  let service: McpServiceType;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    mockProviders.length = 0;
    mockFs = createMemoryFs();
    const { McpService } = await import('./McpService');
    service = new McpService();
  });

  describe('searchIntegrationsSh', () => {
    it('maps matching MCP surfaces into installable catalog entries', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              {
                domain: 'linear.app',
                icon: 'https://integrations.sh/logo/linear.app',
                formats: { mcp: 1 },
                popularity: 100,
                description: 'Manage issues and projects',
              },
            ],
          })
        )
        .mockResolvedValueOnce(
          jsonResponse({
            surfaces: [
              {
                type: 'mcp',
                slug: 'linear',
                name: 'Linear MCP server',
                docs: 'https://linear.app/docs/mcp',
                url: 'https://mcp.linear.app/mcp',
              },
            ],
          })
        );
      vi.stubGlobal('fetch', fetchMock);

      await expect(service.searchIntegrationsSh('linear')).resolves.toEqual([
        expect.objectContaining({
          key: 'integrations-sh-linear.app-linear',
          name: 'Linear MCP server',
          docsUrl: 'https://linear.app/docs/mcp',
          defaultConfig: { type: 'http', url: 'https://mcp.linear.app/mcp' },
        }),
      ]);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock).toHaveBeenLastCalledWith(
        'https://integrations.sh/api/linear.app/surface',
        expect.anything()
      );
    });

    it('discards MCP surfaces without a safe install configuration', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse({
              data: [
                {
                  domain: 'unsafe.example',
                  icon: 'file:///tmp/icon.svg',
                  formats: { mcp: 1 },
                  popularity: 1,
                  description: 'Unsafe example',
                },
              ],
            })
          )
          .mockResolvedValueOnce(
            jsonResponse({
              surfaces: [
                {
                  type: 'mcp',
                  slug: 'unsafe',
                  name: 'Unsafe MCP',
                  url: 'javascript:alert(1)',
                },
                { type: 'mcp', slug: 'missing', name: 'Missing config' },
              ],
            })
          )
      );

      await expect(service.searchIntegrationsSh('unsafe')).resolves.toEqual([]);
    });

    it('keeps results from healthy domains when another domain fetch fails', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse({
              data: [
                {
                  domain: 'flaky.example',
                  icon: 'https://integrations.sh/logo/flaky.example',
                  formats: { mcp: 1 },
                  popularity: 200,
                  description: 'Example tracker',
                },
                {
                  domain: 'healthy.example',
                  icon: 'https://integrations.sh/logo/healthy.example',
                  formats: { mcp: 1 },
                  popularity: 100,
                  description: 'Example tracker',
                },
              ],
            })
          )
          .mockRejectedValueOnce(new Error('network down'))
          .mockResolvedValueOnce(
            jsonResponse({
              surfaces: [
                {
                  type: 'mcp',
                  slug: 'healthy',
                  name: 'Healthy MCP',
                  url: 'https://mcp.healthy.example/mcp',
                },
              ],
            })
          )
          .mockResolvedValueOnce(
            jsonResponse({
              surfaces: [
                {
                  type: 'mcp',
                  slug: 'flaky',
                  name: 'Recovered MCP',
                  url: 'https://mcp.flaky.example/mcp',
                },
              ],
            })
          )
          .mockResolvedValueOnce(
            jsonResponse({
              surfaces: [
                {
                  type: 'mcp',
                  slug: 'healthy',
                  name: 'Healthy MCP',
                  url: 'https://mcp.healthy.example/mcp',
                },
              ],
            })
          )
      );

      await expect(service.searchIntegrationsSh('tracker')).resolves.toEqual([
        expect.objectContaining({ key: 'integrations-sh-healthy.example-healthy' }),
      ]);

      await expect(service.searchIntegrationsSh('tracker')).resolves.toHaveLength(2);
      expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('reports a domains request failure when no stale cache exists', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('network down')));

      await expect(service.searchIntegrationsSh('linear')).rejects.toThrow('network down');
    });

    it('rejects an invalid domains document', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(jsonResponse({ data: null })));

      await expect(service.searchIntegrationsSh('linear')).rejects.toThrow(
        'invalid domains document'
      );
    });

    it('shares an in-flight domains request between searches', async () => {
      let resolveDomains!: (response: Response) => void;
      const domainsResponse = new Promise<Response>((resolve) => {
        resolveDomains = resolve;
      });
      const fetchMock = vi
        .fn()
        .mockReturnValueOnce(domainsResponse)
        .mockResolvedValue(
          jsonResponse({
            surfaces: [
              {
                type: 'mcp',
                slug: 'linear',
                name: 'Linear MCP server',
                url: 'https://mcp.linear.app/mcp',
              },
            ],
          })
        );
      vi.stubGlobal('fetch', fetchMock);

      const firstSearch = service.searchIntegrationsSh('linear');
      const secondSearch = service.searchIntegrationsSh('issues');
      expect(fetchMock).toHaveBeenCalledTimes(1);

      resolveDomains(
        jsonResponse({
          data: [
            {
              domain: 'linear.app',
              icon: 'https://integrations.sh/logo/linear.app',
              formats: { mcp: 1 },
              popularity: 100,
              description: 'Manage issues and projects',
            },
          ],
        })
      );
      await Promise.all([firstSearch, secondSearch]);
      expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it('omits unsafe icon URLs from otherwise valid entries', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse({
              data: [
                {
                  domain: 'icon.example',
                  icon: 'file:///tmp/icon.svg',
                  formats: { mcp: 1 },
                  popularity: 1,
                  description: 'Icon example',
                },
              ],
            })
          )
          .mockResolvedValueOnce(
            jsonResponse({
              surfaces: [
                {
                  type: 'mcp',
                  slug: 'icon',
                  name: 'Icon MCP',
                  url: 'https://mcp.icon.example/mcp',
                },
              ],
            })
          )
      );

      await expect(service.searchIntegrationsSh('icon')).resolves.toEqual([
        expect.objectContaining({ iconUrl: undefined }),
      ]);
    });

    it('falls back to the integrations.sh docs page for non-http docs URLs', async () => {
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValueOnce(
            jsonResponse({
              data: [
                {
                  domain: 'docs.example',
                  icon: 'https://integrations.sh/logo/docs.example',
                  formats: { mcp: 1 },
                  popularity: 1,
                  description: 'Docs example',
                },
              ],
            })
          )
          .mockResolvedValueOnce(
            jsonResponse({
              surfaces: [
                {
                  type: 'mcp',
                  slug: 'docs',
                  name: 'Docs MCP',
                  docs: 'file:///etc/passwd',
                  url: 'https://mcp.docs.example/mcp',
                },
              ],
            })
          )
      );

      await expect(service.searchIntegrationsSh('docs')).resolves.toEqual([
        expect.objectContaining({ docsUrl: 'https://integrations.sh/docs.example/docs/' }),
      ]);
    });
  });

  describe('loadAll', () => {
    it('reads servers from all MCP agents and returns McpServer[]', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      await mockFs.write(
        '.claude.json',
        JSON.stringify({
          mcpServers: { myServer: { command: 'npx', args: ['-y', 'foo'] } },
        })
      );

      const result = await service.loadAll();
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0].name).toBe('myServer');
      expect(result.installed[0].transport).toBe('stdio');
      expect(result.installed[0].providers).toContain('claude');
    });

    it('deduplicates by name, merging providers', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      mockProviders.push(fakeProvider('cursor', '.cursor/mcp.json'));
      const serverJson = JSON.stringify({ mcpServers: { shared: { command: 'npx' } } });
      await mockFs.write('.claude.json', serverJson);
      await mockFs.write('.cursor/mcp.json', serverJson);

      const result = await service.loadAll();
      expect(result.installed).toHaveLength(1);
      expect(result.installed[0].providers).toContain('claude');
      expect(result.installed[0].providers).toContain('cursor');
    });

    it('prefers entry with more fields when merging the same name', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      mockProviders.push(fakeProvider('cursor', '.cursor/mcp.json'));
      await mockFs.write(
        '.claude.json',
        JSON.stringify({
          mcpServers: { s: { command: 'npx', args: ['foo'], env: { KEY: 'VAL' } } },
        })
      );
      await mockFs.write(
        '.cursor/mcp.json',
        JSON.stringify({
          mcpServers: { s: { command: 'npx' } },
        })
      );

      const result = await service.loadAll();
      expect(result.installed[0].args).toEqual(['foo']);
    });

    it('prefers runnable entries over metadata-only disabled stubs when merging', async () => {
      mockProviders.push(fakeProvider('opencode', '.opencode.json'));
      mockProviders.push(fakeProvider('cursor', '.cursor/mcp.json'));
      await mockFs.write(
        '.opencode.json',
        JSON.stringify({
          mcpServers: { shared: { enabled: false } },
        })
      );
      await mockFs.write(
        '.cursor/mcp.json',
        JSON.stringify({
          mcpServers: { shared: { command: 'npx' } },
        })
      );

      const result = await service.loadAll();
      expect(result.installed[0]).toMatchObject({
        name: 'shared',
        command: 'npx',
        providers: ['opencode', 'cursor'],
      });
    });

    it('skips agents that throw on read', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      mockProviders.push(fakeProvider('cursor', '.cursor/mcp.json'));
      await mockFs.write(
        '.cursor/mcp.json',
        JSON.stringify({
          mcpServers: { s1: { command: 'npx' } },
        })
      );
      // .claude.json is missing — returns [] (no error), but let's force a throw via a bad mcp behavior
      mockProviders[0].behavior.mcp!.readServers = async () => {
        throw new Error('read error');
      };

      const result = await service.loadAll();
      expect(result.installed).toHaveLength(1);
    });
  });

  describe('saveServer', () => {
    it('adds server to selected providers', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      mockProviders.push(fakeProvider('cursor', '.cursor/mcp.json'));

      const server: McpServer = {
        name: 'myServer',
        transport: 'stdio',
        command: 'npx',
        args: ['-y', 'foo'],
        providers: ['claude'],
      };
      await service.saveServer(server);

      const content = await mockFs.read('.claude.json');
      expect(content).not.toBeNull();
      const parsed = JSON.parse(content!) as { mcpServers: Record<string, unknown> };
      expect(parsed.mcpServers.myServer).toBeDefined();

      const cursorContent = await mockFs.read('.cursor/mcp.json');
      expect(cursorContent).toBeNull(); // not written
    });

    it('removes server from deselected providers', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      await mockFs.write(
        '.claude.json',
        JSON.stringify({
          mcpServers: { myServer: { command: 'npx' }, other: { command: 'y' } },
        })
      );

      const server: McpServer = {
        name: 'myServer',
        transport: 'stdio',
        command: 'npx',
        providers: ['cursor'], // claude NOT selected
      };
      await service.saveServer(server);

      const content = await mockFs.read('.claude.json');
      const parsed = JSON.parse(content!) as { mcpServers: Record<string, unknown> };
      expect(parsed.mcpServers.myServer).toBeUndefined();
      expect(parsed.mcpServers.other).toBeDefined(); // other server preserved
    });

    it('preserves unrelated servers when saving', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      await mockFs.write(
        '.claude.json',
        JSON.stringify({
          mcpServers: { existing: { command: 'already-there' } },
        })
      );

      await service.saveServer({
        name: 'new',
        transport: 'stdio',
        command: 'npx',
        providers: ['claude'],
      });

      const content = await mockFs.read('.claude.json');
      const parsed = JSON.parse(content!) as { mcpServers: Record<string, unknown> };
      expect(parsed.mcpServers.existing).toBeDefined();
      expect(parsed.mcpServers.new).toBeDefined();
    });

    it('rejects empty server name', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      await expect(
        service.saveServer({ name: '', transport: 'stdio', command: 'x', providers: ['claude'] })
      ).rejects.toThrow('Invalid server name');
    });

    it('rejects server name with invalid characters', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      await expect(
        service.saveServer({
          name: 'bad name/slash',
          transport: 'stdio',
          command: 'x',
          providers: ['claude'],
        })
      ).rejects.toThrow('Invalid server name');
    });
  });

  describe('removeServer', () => {
    it('removes server from all agent configs while preserving others', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      mockProviders.push(fakeProvider('cursor', '.cursor/mcp.json'));
      const serverJson = JSON.stringify({
        mcpServers: { toRemove: { command: 'npx' }, keep: { command: 'y' } },
      });
      await mockFs.write('.claude.json', serverJson);
      await mockFs.write('.cursor/mcp.json', serverJson);

      await service.removeServer('toRemove');

      for (const path of ['.claude.json', '.cursor/mcp.json']) {
        const content = await mockFs.read(path);
        const parsed = JSON.parse(content!) as { mcpServers: Record<string, unknown> };
        expect(parsed.mcpServers.toRemove).toBeUndefined();
        expect(parsed.mcpServers.keep).toBeDefined();
      }
    });
  });

  describe('listForAgent', () => {
    it('returns servers for a specific agent', async () => {
      mockProviders.push(fakeProvider('claude', '.claude.json'));
      await mockFs.write(
        '.claude.json',
        JSON.stringify({
          mcpServers: { s1: { command: 'npx' }, s2: { url: 'https://x.com', type: 'http' } },
        })
      );

      const servers = await service.listForAgent('claude');
      expect(servers).toHaveLength(2);
      expect(servers.every((s) => s.providers.includes('claude'))).toBe(true);
    });

    it('returns empty array for unknown agent', async () => {
      const servers = await service.listForAgent('unknown-agent');
      expect(servers).toEqual([]);
    });

    it('returns empty array when agent has no mcp behavior', async () => {
      mockProviders.push({
        metadata: { id: 'no-mcp', name: 'No MCP', description: '', websiteUrl: '' },
        capabilities: { mcp: { kind: 'none' as const } },
        behavior: { mcp: undefined },
      } as unknown as ReturnType<typeof fakeProvider>);

      const servers = await service.listForAgent('no-mcp');
      expect(servers).toEqual([]);
    });
  });
});
