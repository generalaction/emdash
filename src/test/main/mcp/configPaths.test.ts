import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('os', () => ({
  default: { homedir: () => '/home/testuser' },
  homedir: () => '/home/testuser',
}));

import { getAgentMcpMeta, getAllMcpAgentIds } from '../../../main/services/mcp/configPaths';

describe('getAgentMcpMeta', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct meta for claude', () => {
    const meta = getAgentMcpMeta('claude');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.claude.json');
    expect(meta!.serversPath).toEqual(['mcpServers']);
    expect(meta!.adapter).toBe('passthrough');
    expect(meta!.isToml).toBe(false);
  });

  it('returns correct meta for cursor', () => {
    const meta = getAgentMcpMeta('cursor');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.cursor/mcp.json');
    expect(meta!.adapter).toBe('cursor');
  });

  it('returns correct meta for codex (toml)', () => {
    const meta = getAgentMcpMeta('codex');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toContain('config.toml');
    expect(meta!.isToml).toBe(true);
    expect(meta!.adapter).toBe('codex');
  });

  it('returns correct meta for amp', () => {
    const meta = getAgentMcpMeta('amp');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.config/amp/settings.json');
    expect(meta!.adapter).toBe('passthrough');
  });

  it('returns correct meta for gemini', () => {
    const meta = getAgentMcpMeta('gemini');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.gemini/settings.json');
    expect(meta!.serversPath).toEqual(['mcpServers']);
    expect(meta!.adapter).toBe('gemini');
  });

  it('returns correct meta for qwen (uses gemini adapter)', () => {
    const meta = getAgentMcpMeta('qwen');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.qwen/settings.json');
    expect(meta!.adapter).toBe('gemini');
  });

  it('returns correct meta for opencode and marks it jsonc-capable', () => {
    const meta = getAgentMcpMeta('opencode');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.config/opencode/opencode.json');
    expect(meta!.adapter).toBe('opencode');
    expect(meta!.isJsonc).toBe(true);
  });

  it('returns correct meta for copilot', () => {
    const meta = getAgentMcpMeta('copilot');
    expect(meta).toBeDefined();
    expect(meta!.configPath).toBe('/home/testuser/.copilot/mcp-config.json');
    expect(meta!.adapter).toBe('copilot');
  });

  it('returns correct meta for droid (passthrough)', () => {
    const meta = getAgentMcpMeta('droid');
    expect(meta).toBeDefined();
    expect(meta!.adapter).toBe('passthrough');
  });

  it('returns undefined for unknown agent', () => {
    const meta = getAgentMcpMeta('unknown-agent');
    expect(meta).toBeUndefined();
  });

  it('getAllMcpAgentIds returns all supported agents', () => {
    const ids = getAllMcpAgentIds();
    expect(ids).toContain('claude');
    expect(ids).toContain('cursor');
    expect(ids).toContain('codex');
    expect(ids).toContain('amp');
    expect(ids).toContain('gemini');
    expect(ids).toContain('qwen');
    expect(ids).toContain('opencode');
    expect(ids).toContain('copilot');
    expect(ids).toContain('droid');
    expect(ids.length).toBe(9);
  });
});
