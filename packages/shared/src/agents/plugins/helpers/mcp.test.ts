import { parse as parseTOML } from 'smol-toml';
import { describe, expect, it } from 'vitest';
import type { PluginFs } from '../../runtime/fs';
import { codexMcpAdapter, createMcpAdapter, passthroughMcpAdapter } from './mcp';

// ── In-memory PluginFs ───────────────────────────────────────────────────────

function createMemoryFs(initial: Record<string, string> = {}): PluginFs {
  const store = new Map<string, string>(Object.entries(initial));
  return {
    async read(path) {
      return store.get(path) ?? null;
    },
    async write(path, content) {
      store.set(path, content);
    },
    async delete(path) {
      store.delete(path);
    },
    async exists(path) {
      return store.has(path);
    },
    async list() {
      return [];
    },
  };
}

function jsonFile(data: unknown): string {
  return JSON.stringify(data, null, 2) + '\n';
}

// ── createMcpAdapter (single path) ──────────────────────────────────────────

describe('createMcpAdapter (single path)', () => {
  const adapter = passthroughMcpAdapter('.test/mcp.json');

  it('readServers returns [] when file does not exist', async () => {
    const fs = createMemoryFs();
    expect(await adapter.readServers(fs)).toEqual([]);
  });

  it('readServers parses existing servers', async () => {
    const fs = createMemoryFs({
      '.test/mcp.json': jsonFile({ mcpServers: { s1: { command: 'npx' } } }),
    });
    const result = await adapter.readServers(fs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('s1');
    expect(result[0].command).toBe('npx');
  });

  it('writeServers preserves unrelated top-level keys', async () => {
    const fs = createMemoryFs({
      '.test/mcp.json': jsonFile({ mcpServers: {}, otherKey: 'preserved' }),
    });
    await adapter.writeServers(fs, [{ name: 'new', command: 'x' }]);
    const raw = await fs.read('.test/mcp.json');
    const parsed = JSON.parse(raw!) as Record<string, unknown>;
    expect(parsed.otherKey).toBe('preserved');
    expect((parsed.mcpServers as Record<string, unknown>).new).toBeDefined();
  });

  it('removeServer removes only the named server', async () => {
    const fs = createMemoryFs({
      '.test/mcp.json': jsonFile({
        mcpServers: { keep: { command: 'x' }, gone: { command: 'y' } },
      }),
    });
    await adapter.removeServer(fs, 'gone');
    const result = await adapter.readServers(fs);
    expect(result.map((r) => r.name)).toEqual(['keep']);
  });
});

// ── legacyReadPaths: merge semantics ────────────────────────────────────────

describe('createMcpAdapter with legacyReadPaths', () => {
  const adapter = passthroughMcpAdapter('.canonical/mcp.json', ['.legacy/mcp.json']);

  it('readServers returns servers from both paths', async () => {
    const fs = createMemoryFs({
      '.canonical/mcp.json': jsonFile({ mcpServers: { canonical: { command: 'c' } } }),
      '.legacy/mcp.json': jsonFile({ mcpServers: { legacy: { command: 'l' } } }),
    });
    const result = await adapter.readServers(fs);
    const names = result.map((r) => r.name).sort();
    expect(names).toEqual(['canonical', 'legacy']);
  });

  it('canonical path wins when name conflicts with legacy', async () => {
    const fs = createMemoryFs({
      '.canonical/mcp.json': jsonFile({ mcpServers: { shared: { command: 'canonical-cmd' } } }),
      '.legacy/mcp.json': jsonFile({ mcpServers: { shared: { command: 'legacy-cmd' } } }),
    });
    const result = await adapter.readServers(fs);
    expect(result).toHaveLength(1);
    expect(result[0].command).toBe('canonical-cmd');
  });

  it('writeServers writes only the canonical path', async () => {
    const fs = createMemoryFs({
      '.legacy/mcp.json': jsonFile({ mcpServers: { old: { command: 'l' } } }),
    });
    await adapter.writeServers(fs, [{ name: 'new', command: 'c' }]);
    expect(await fs.read('.canonical/mcp.json')).not.toBeNull();
    // Legacy file unchanged
    const legacy = JSON.parse((await fs.read('.legacy/mcp.json'))!) as Record<string, unknown>;
    expect((legacy.mcpServers as Record<string, unknown>).old).toBeDefined();
  });

  it('removeServer removes from canonical and all legacy paths', async () => {
    const fs = createMemoryFs({
      '.canonical/mcp.json': jsonFile({
        mcpServers: { gone: { command: 'c' }, keep: { command: 'k' } },
      }),
      '.legacy/mcp.json': jsonFile({ mcpServers: { gone: { command: 'l' } } }),
    });
    await adapter.removeServer(fs, 'gone');
    const canonical = await adapter.readServers(fs);
    expect(canonical.map((r) => r.name)).toEqual(['keep']);
    const legacyContent = await fs.read('.legacy/mcp.json');
    const legacyParsed = JSON.parse(legacyContent!) as Record<string, unknown>;
    expect((legacyParsed.mcpServers as Record<string, unknown>).gone).toBeUndefined();
  });

  it('removeServer is a no-op if server does not exist in either path', async () => {
    const fs = createMemoryFs({
      '.canonical/mcp.json': jsonFile({ mcpServers: { keep: { command: 'k' } } }),
    });
    await expect(adapter.removeServer(fs, 'missing')).resolves.not.toThrow();
    const result = await adapter.readServers(fs);
    expect(result).toHaveLength(1);
  });

  it('handles missing canonical file gracefully on read', async () => {
    const fs = createMemoryFs({
      '.legacy/mcp.json': jsonFile({ mcpServers: { s: { command: 'x' } } }),
    });
    const result = await adapter.readServers(fs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('s');
  });

  it('handles malformed legacy file gracefully (ignores it)', async () => {
    const fs = createMemoryFs({
      '.canonical/mcp.json': jsonFile({ mcpServers: { good: { command: 'c' } } }),
      '.legacy/mcp.json': 'not valid json { }{{',
    });
    const result = await adapter.readServers(fs);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('good');
  });
});

// ── Multi-legacy paths ───────────────────────────────────────────────────────

describe('createMcpAdapter with multiple legacyReadPaths', () => {
  const adapter = createMcpAdapter({
    configPath: '.canon/mcp.json',
    legacyReadPaths: ['.legacy1/mcp.json', '.legacy2/mcp.json'],
    format: 'json',
    serversKey: 'mcpServers',
    toNative(s) {
      const { name: _n, ...r } = s;
      return r as Record<string, unknown>;
    },
    fromNative(name, raw) {
      return { name, ...raw };
    },
  });

  it('reads servers from all three paths', async () => {
    const fs = createMemoryFs({
      '.canon/mcp.json': jsonFile({ mcpServers: { a: { command: 'a' } } }),
      '.legacy1/mcp.json': jsonFile({ mcpServers: { b: { command: 'b' } } }),
      '.legacy2/mcp.json': jsonFile({ mcpServers: { c: { command: 'c' } } }),
    });
    const result = await adapter.readServers(fs);
    expect(result.map((r) => r.name).sort()).toEqual(['a', 'b', 'c']);
  });

  it('removes from all paths', async () => {
    const fs = createMemoryFs({
      '.canon/mcp.json': jsonFile({ mcpServers: { gone: { command: 'a' } } }),
      '.legacy1/mcp.json': jsonFile({ mcpServers: { gone: { command: 'b' } } }),
      '.legacy2/mcp.json': jsonFile({ mcpServers: { gone: { command: 'c' } } }),
    });
    await adapter.removeServer(fs, 'gone');
    for (const path of ['.canon/mcp.json', '.legacy1/mcp.json', '.legacy2/mcp.json']) {
      const content = await fs.read(path);
      if (!content) continue;
      const parsed = JSON.parse(content) as Record<string, unknown>;
      expect((parsed.mcpServers as Record<string, unknown>).gone).toBeUndefined();
    }
  });
});

// ── Codex TOML adapter ──────────────────────────────────────────────────────

describe('codexMcpAdapter', () => {
  const adapter = codexMcpAdapter('.codex/config.toml');

  it('maps HTTP headers to Codex http_headers on write', async () => {
    const fs = createMemoryFs({
      '.codex/config.toml': 'model = "gpt-5"\n',
    });

    await adapter.writeServers(fs, [
      {
        name: 'docs',
        transport: 'http',
        type: 'http',
        url: 'https://example.com/mcp',
        headers: { Authorization: 'Bearer token' },
      },
    ]);

    const raw = await fs.read('.codex/config.toml');
    const parsed = parseTOML(raw!) as Record<string, unknown>;
    const servers = parsed.mcp_servers as Record<string, Record<string, unknown>>;

    expect(parsed.model).toBe('gpt-5');
    expect(servers.docs.url).toBe('https://example.com/mcp');
    expect(servers.docs.type).toBeUndefined();
    expect(servers.docs.transport).toBeUndefined();
    expect(servers.docs.headers).toBeUndefined();
    expect(servers.docs.http_headers).toEqual({ Authorization: 'Bearer token' });
  });

  it('reads Codex HTTP headers into the canonical headers field', async () => {
    const fs = createMemoryFs({
      '.codex/config.toml': [
        '[mcp_servers.docs]',
        'url = "https://example.com/mcp"',
        '',
        '[mcp_servers.docs.http_headers]',
        'Authorization = "Bearer token"',
      ].join('\n'),
    });

    const result = await adapter.readServers(fs);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'docs',
      transport: 'http',
      type: 'http',
      url: 'https://example.com/mcp',
      headers: { Authorization: 'Bearer token' },
    });
    expect(result[0].http_headers).toBeUndefined();
  });
});
