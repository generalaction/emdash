import { describe, expect, it, vi } from 'vitest';
import type { ProviderPluginDeps } from '../types';
import { claudePlugin } from './claude';

vi.mock('@main/core/agent-hooks/claude-trust-service', () => ({
  claudeTrustService: {
    maybeAutoTrustLocal: vi.fn().mockResolvedValue(undefined),
  },
}));

function makeDeps(overrides?: Partial<ProviderPluginDeps>): ProviderPluginDeps {
  return {
    readProjectFile: vi.fn().mockResolvedValue(undefined),
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    readUserFile: vi.fn().mockResolvedValue(undefined),
    writeUserFile: vi.fn().mockResolvedValue(undefined),
    platform: 'darwin',
    ...overrides,
  };
}

describe('claudePlugin', () => {
  it('writes hook config to .claude/settings.local.json', async () => {
    const deps = makeDeps();
    const plugin = claudePlugin(deps);

    const result = await plugin.writeHookConfig?.();

    expect(result).toBe(true);
    expect(deps.writeProjectFile).toHaveBeenCalledWith(
      '.claude/settings.local.json',
      expect.stringContaining('EMDASH_HOOK_PORT')
    );
  });

  it('includes both notification and stop hook entries', async () => {
    const deps = makeDeps();
    const plugin = claudePlugin(deps);
    await plugin.writeHookConfig?.();

    const [, content] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    const config = JSON.parse(content) as { hooks: Record<string, unknown[]> };
    expect(config.hooks.Notification).toBeDefined();
    expect(config.hooks.Stop).toBeDefined();
  });

  it('preserves user-defined hook entries that lack the emdash marker', async () => {
    const existing = JSON.stringify({
      hooks: {
        Notification: [{ hooks: [{ type: 'command', command: 'my-custom-hook' }] }],
      },
    });
    const deps = makeDeps({ readProjectFile: vi.fn().mockResolvedValue(existing) });
    const plugin = claudePlugin(deps);
    await plugin.writeHookConfig?.();

    const [, content] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    const config = JSON.parse(content) as { hooks: Record<string, unknown[]> };
    expect(config.hooks.Notification).toHaveLength(2);
    expect(JSON.stringify(config.hooks.Notification)).toContain('my-custom-hook');
  });

  it('replaces existing emdash-managed entries on re-run', async () => {
    const existing = JSON.stringify({
      hooks: {
        Notification: [
          {
            hooks: [{ type: 'command', command: 'curl ... EMDASH_HOOK_PORT ...' }],
          },
        ],
      },
    });
    const deps = makeDeps({ readProjectFile: vi.fn().mockResolvedValue(existing) });
    const plugin = claudePlugin(deps);
    await plugin.writeHookConfig?.();

    const [, content] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    const config = JSON.parse(content) as { hooks: Record<string, unknown[]> };
    expect(config.hooks.Notification).toHaveLength(1);
  });

  it('uses powershell command on win32', async () => {
    const deps = makeDeps({ platform: 'win32' });
    const plugin = claudePlugin(deps);
    await plugin.writeHookConfig?.();

    const [, content] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(content).toContain('powershell.exe');
  });

  it('exposes supportsHooks and gitIgnorePaths', () => {
    const plugin = claudePlugin(makeDeps());
    expect(plugin.supportsHooks).toBe(true);
    expect(plugin.gitIgnorePaths).toContain('.claude/settings.local.json');
  });
});
