import { describe, expect, it } from 'vitest';
import type { McpServerRegistration } from '../core/capabilities';
import type { CLIAgentPluginFs } from '../core/plugin';
import { createMcpAdapter, passthroughMcpAdapter } from './mcp';

function makeMockFs(files: Record<string, string> = {}): CLIAgentPluginFs & {
  store: Record<string, string>;
} {
  const store: Record<string, string> = { ...files };
  return {
    store,
    async read(path) {
      return store[path] ?? null;
    },
    async write(path, content) {
      store[path] = content;
    },
    async delete(path) {
      delete store[path];
    },
    async exists(path) {
      return path in store;
    },
    async list() {
      return [];
    },
  };
}

const sampleServer: McpServerRegistration = {
  name: 'my-server',
  transport: 'stdio',
  command: 'node',
  args: ['server.js'],
  env: { PORT: '3000' },
};

describe('createMcpAdapter (JSON)', () => {
  const adapter = createMcpAdapter({
    configPath: 'mcp.json',
    format: 'json',
    serversKey: 'mcpServers',
    toNative: ({ name: _name, ...rest }) => rest,
    fromNative: (name, raw) => ({ name, ...raw }) as McpServerRegistration,
  });

  it('reads empty array when file does not exist', async () => {
    const fs = makeMockFs();
    expect(await adapter.readServers(fs)).toEqual([]);
  });

  it('reads servers from existing JSON file', async () => {
    const fs = makeMockFs({
      'mcp.json': JSON.stringify({
        mcpServers: {
          'my-server': { transport: 'stdio', command: 'node', args: ['server.js'] },
        },
      }),
    });
    const servers = await adapter.readServers(fs);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('my-server');
    expect(servers[0].transport).toBe('stdio');
  });

  it('writes servers to JSON file', async () => {
    const fs = makeMockFs();
    await adapter.writeServers(fs, [sampleServer]);
    const raw = JSON.parse(fs.store['mcp.json']);
    expect(raw.mcpServers['my-server']).toBeDefined();
  });

  it('merges with existing file content when writing', async () => {
    const existing = { otherConfig: 'preserved', mcpServers: { old: { transport: 'stdio' } } };
    const fs = makeMockFs({ 'mcp.json': JSON.stringify(existing) });
    await adapter.writeServers(fs, [sampleServer]);
    const raw = JSON.parse(fs.store['mcp.json']);
    expect(raw.otherConfig).toBe('preserved');
    expect(raw.mcpServers['my-server']).toBeDefined();
    // Old server is overwritten since writeServers replaces the whole key
    expect(raw.mcpServers['old']).toBeUndefined();
  });

  it('removes a server by name', async () => {
    const fs = makeMockFs({
      'mcp.json': JSON.stringify({
        mcpServers: {
          'keep-me': { transport: 'stdio' },
          'remove-me': { transport: 'stdio' },
        },
      }),
    });
    await adapter.removeServer(fs, 'remove-me');
    const servers = await adapter.readServers(fs);
    expect(servers.map((s) => s.name)).toEqual(['keep-me']);
  });
});

describe('createMcpAdapter (TOML)', () => {
  const adapter = createMcpAdapter({
    configPath: 'mcp.toml',
    format: 'toml',
    serversKey: 'mcpServers',
    toNative: ({ name: _name, ...rest }) => rest,
    fromNative: (name, raw) => ({ name, ...raw }) as McpServerRegistration,
  });

  it('reads from TOML file', async () => {
    const fs = makeMockFs({
      'mcp.toml': '[mcpServers]\n[mcpServers.my-server]\ntransport = "stdio"\ncommand = "node"\n',
    });
    const servers = await adapter.readServers(fs);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe('my-server');
  });

  it('round-trips write and read', async () => {
    const fs = makeMockFs();
    await adapter.writeServers(fs, [{ name: 'srv', transport: 'stdio', command: 'bin' }]);
    const servers = await adapter.readServers(fs);
    expect(servers[0].name).toBe('srv');
    expect(servers[0].command).toBe('bin');
  });
});

describe('passthroughMcpAdapter', () => {
  const adapter = passthroughMcpAdapter('config.json');

  it('writes and reads back without transformation', async () => {
    const fs = makeMockFs();
    await adapter.writeServers(fs, [sampleServer]);
    const result = await adapter.readServers(fs);
    expect(result[0].name).toBe('my-server');
    expect(result[0].transport).toBe('stdio');
  });
});
