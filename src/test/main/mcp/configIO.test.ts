import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as jsoncParser from 'jsonc-parser';
import type { AgentMcpMeta } from '@shared/mcp/types';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../../../main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

import * as fs from 'fs/promises';
import { readServers, writeServers } from '../../../main/services/mcp/configIO';

const mockFs = vi.mocked(fs);

function makeMeta(overrides: Partial<AgentMcpMeta> = {}): AgentMcpMeta {
  return {
    agentId: 'claude',
    configPath: '/home/test/.claude.json',
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
    ...overrides,
  };
}

describe('readServers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads JSON config and extracts servers at path', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ mcpServers: { s1: { command: 'npx' } } }));
    const result = await readServers(makeMeta());
    expect(result).toEqual({ s1: { command: 'npx' } });
  });

  it('returns empty object when file does not exist', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockFs.readFile.mockRejectedValue(err);
    const result = await readServers(makeMeta());
    expect(result).toEqual({});
  });

  it('returns empty object when servers path not found in config', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ other: 'stuff' }));
    const result = await readServers(makeMeta());
    expect(result).toEqual({});
  });

  it('handles nested serversPath', async () => {
    const meta = makeMeta({
      serversPath: ['settings', 'mcp', 'servers'],
      template: { settings: { mcp: { servers: {} } } },
    });
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({ settings: { mcp: { servers: { s1: { command: 'x' } } } } })
    );
    const result = await readServers(meta);
    expect(result).toEqual({ s1: { command: 'x' } });
  });

  it('reads TOML config for codex', async () => {
    const meta = makeMeta({
      agentId: 'codex',
      configPath: '/home/test/.codex/config.toml',
      serversPath: ['mcp_servers'],
      isToml: true,
      adapter: 'codex',
    });
    mockFs.readFile.mockResolvedValue(
      '[mcp_servers.myserver]\ncommand = "npx"\nargs = ["-y", "foo"]\n'
    );
    const result = await readServers(meta);
    expect(result.myserver).toBeDefined();
    expect((result.myserver as any).command).toBe('npx');
  });

  it('reads jsonc-capable opencode json files with comments and trailing commas', async () => {
    const meta = makeMeta({
      agentId: 'opencode',
      configPath: '/home/test/.config/opencode/opencode.json',
      serversPath: ['mcp'],
      template: { mcp: {} },
      adapter: 'opencode',
      isJsonc: true,
    });
    mockFs.readFile.mockResolvedValue(`{
  // keep comment
  "theme": "dark",
  "mcp": {
    "s1": {
      "type": "local",
      "command": ["npx", "-y", "foo"],
    },
  },
}`);

    const result = await readServers(meta);

    expect(result).toEqual({
      s1: {
        type: 'local',
        command: ['npx', '-y', 'foo'],
      },
    });
  });

  it('throws when jsonc-capable opencode config cannot be parsed safely', async () => {
    const meta = makeMeta({
      agentId: 'opencode',
      configPath: '/home/test/.config/opencode/opencode.json',
      serversPath: ['mcp'],
      template: { mcp: {} },
      adapter: 'opencode',
      isJsonc: true,
    });
    mockFs.readFile.mockResolvedValue(`{
  "theme": "dark",
  "mcp": {
    "s1": {
      "type": "local",
      "command": ["npx"]
    }
`);

    await expect(readServers(meta)).rejects.toThrow(/Failed to safely parse JSONC config/);
  });
});

describe('writeServers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('writes JSON config merging servers at path', async () => {
    mockFs.readFile.mockResolvedValue(JSON.stringify({ otherKey: 'keep' }));
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeServers(makeMeta(), { s1: { command: 'npx' } });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string);
    expect(written.mcpServers).toEqual({ s1: { command: 'npx' } });
    expect(written.otherKey).toBe('keep');
  });

  it('preserves all sibling keys outside the servers path', async () => {
    mockFs.readFile.mockResolvedValue(
      JSON.stringify({
        theme: 'dark',
        mcpServers: { oldServer: { command: 'old' } },
        anotherKey: [1, 2, 3],
      })
    );
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeServers(makeMeta(), { newServer: { command: 'new' } });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string);
    expect(written.theme).toBe('dark');
    expect(written.anotherKey).toEqual([1, 2, 3]);
    expect(written.mcpServers).toEqual({ newServer: { command: 'new' } });
  });

  it('creates file from template when file does not exist', async () => {
    const err = new Error('ENOENT') as NodeJS.ErrnoException;
    err.code = 'ENOENT';
    mockFs.readFile.mockRejectedValue(err);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeServers(makeMeta(), { s1: { command: 'npx' } });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string);
    expect(written.mcpServers).toEqual({ s1: { command: 'npx' } });
  });

  it('keeps malformed plain json fallback behavior unchanged', async () => {
    mockFs.readFile.mockResolvedValue('{ invalid json }');
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeServers(makeMeta(), { s1: { command: 'npx' } });

    const written = JSON.parse(mockFs.writeFile.mock.calls[0][1] as string);
    expect(written).toEqual({ mcpServers: { s1: { command: 'npx' } } });
  });

  it('preserves sibling keys and comments when updating jsonc-capable opencode json files', async () => {
    const meta = makeMeta({
      agentId: 'opencode',
      configPath: '/home/test/.config/opencode/opencode.json',
      serversPath: ['mcp'],
      template: { mcp: {} },
      adapter: 'opencode',
      isJsonc: true,
    });
    mockFs.readFile.mockResolvedValue(`{
  // keep comment
  "theme": "dark",
  "plugin": ["acme-plugin"],
  "mcp": {
    "oldServer": {
      "type": "local",
      "command": ["old"],
    },
  },
}`);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeServers(meta, {
      newServer: { type: 'remote', url: 'https://example.com/mcp' },
    });

    const written = mockFs.writeFile.mock.calls[0][1] as string;
    expect(written).toContain('// keep comment');

    const parsed = jsoncParser.parse(written) as Record<string, any>;
    expect(parsed.theme).toBe('dark');
    expect(parsed.plugin).toEqual(['acme-plugin']);
    expect(parsed.mcp).toEqual({
      newServer: { type: 'remote', url: 'https://example.com/mcp' },
    });
  });

  it('throws instead of resetting jsonc-capable opencode config when parsing is unsafe', async () => {
    const meta = makeMeta({
      agentId: 'opencode',
      configPath: '/home/test/.config/opencode/opencode.json',
      serversPath: ['mcp'],
      template: { mcp: {} },
      adapter: 'opencode',
      isJsonc: true,
    });
    mockFs.readFile.mockResolvedValue(`{
  "theme": "dark",
  "mcp": {
    "oldServer": {
      "type": "local",
      "command": ["old"]
    }
`);
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await expect(
      writeServers(meta, {
        newServer: { type: 'remote', url: 'https://example.com/mcp' },
      })
    ).rejects.toThrow(/Failed to safely parse JSONC config/);
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});
