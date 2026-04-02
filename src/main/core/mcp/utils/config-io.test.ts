import * as fs from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentMcpMeta } from '@shared/mcp/types';
import { readServers, writeServers } from './config-io';

vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
}));

vi.mock('../../../main/lib/logger', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

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
    expect(result.myserver.command).toBe('npx');
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
});
