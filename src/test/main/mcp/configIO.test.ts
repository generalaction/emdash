import { describe, it, expect, vi, beforeEach } from 'vitest';
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
    format: 'json',
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
      format: 'toml',
      adapter: 'codex',
    });
    mockFs.readFile.mockResolvedValue(
      '[mcp_servers.myserver]\ncommand = "npx"\nargs = ["-y", "foo"]\n'
    );
    const result = await readServers(meta);
    expect(result.myserver).toBeDefined();
    expect((result.myserver as any).command).toBe('npx');
  });

  it('reads OpenCode config as JSONC even with a .json path', async () => {
    const meta = makeMeta({
      agentId: 'opencode',
      configPath: '/home/test/.config/opencode/opencode.json',
      serversPath: ['mcp'],
      template: { mcp: {} },
      format: 'jsonc',
      adapter: 'opencode',
    });
    mockFs.readFile.mockResolvedValue(
      '{\n  // keep my config\n  "theme": "dark",\n  "mcp": {\n    "s1": { "type": "local", "command": ["npx", "-y", "foo"] },\n  },\n}\n'
    );

    const result = await readServers(meta);

    expect(result.s1).toBeDefined();
    expect((result.s1 as any).type).toBe('local');
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

  it('preserves sibling keys and comments for OpenCode JSONC stored as .json', async () => {
    const meta = makeMeta({
      agentId: 'opencode',
      configPath: '/home/test/.config/opencode/opencode.json',
      serversPath: ['mcp'],
      template: { mcp: {} },
      format: 'jsonc',
      adapter: 'opencode',
    });
    mockFs.readFile.mockResolvedValue(
      '{\n  // keep my config\n  "theme": "dark",\n  "model": "gpt-5",\n  "mcp": {\n    "oldServer": { "type": "local", "command": ["old"] }\n  }\n}\n'
    );
    mockFs.mkdir.mockResolvedValue(undefined);
    mockFs.writeFile.mockResolvedValue(undefined);

    await writeServers(meta, {
      newServer: { type: 'local', command: ['npx', '-y', 'foo'], enabled: true },
    });

    const written = mockFs.writeFile.mock.calls[0][1] as string;
    expect(written).toContain('// keep my config');
    expect(written).toContain('"theme": "dark"');
    expect(written).toContain('"model": "gpt-5"');
    expect(written).toContain('"newServer"');
    expect(written).not.toContain('"oldServer"');
  });

  it('throws instead of resetting an invalid existing JSON config', async () => {
    mockFs.readFile.mockResolvedValue('{ invalid json');
    mockFs.mkdir.mockResolvedValue(undefined);

    await expect(writeServers(makeMeta(), { s1: { command: 'npx' } })).rejects.toThrow(
      'Invalid JSON in /home/test/.claude.json'
    );
    expect(mockFs.writeFile).not.toHaveBeenCalled();
  });
});
