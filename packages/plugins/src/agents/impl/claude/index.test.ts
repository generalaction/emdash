import { describe, expect, it } from 'vitest';
import { createClaudeProvider, provider } from './index';

describe('Claude Code host dependency', () => {
  const windows = provider.capabilities.hostDependency.installCommands?.windows ?? [];

  it('lists the native installer first on Windows, unchanged', () => {
    expect(windows[0]).toMatchObject({
      method: 'curl',
      command:
        'curl -fsSL https://claude.ai/install.cmd -o install.cmd && install.cmd && del install.cmd',
      uninstallCommand: 'claude uninstall',
    });
  });

  it('offers WinGet on Windows with its own update and uninstall commands', () => {
    expect(windows.find((option) => option.method === 'winget')).toMatchObject({
      command: 'winget install Anthropic.ClaudeCode',
      updateCommand: 'winget upgrade Anthropic.ClaudeCode',
      uninstallCommand: 'winget uninstall Anthropic.ClaudeCode',
    });
  });

  it('does not offer WinGet on macOS or Linux', () => {
    const { macos = [], linux = [] } = provider.capabilities.hostDependency.installCommands ?? {};
    expect([...macos, ...linux].some((option) => option.method === 'winget')).toBe(false);
  });
});

describe('Claude Code configured instances', () => {
  it('reports usage limits for the built-in provider', () => {
    expect(provider.capabilities.usageLimits).toEqual({ kind: 'supported' });
    expect(provider.behavior.usageLimits).toBeDefined();
  });

  it('leaves usage limits off for a configured instance', () => {
    const instance = createClaudeProvider({ id: 'claude-work', name: 'Claude (Work)' });

    expect(instance.metadata.id).toBe('claude-work');
    expect(instance.capabilities.usageLimits).toEqual({ kind: 'none' });
    expect(instance.behavior.usageLimits).toBeUndefined();
  });
});
