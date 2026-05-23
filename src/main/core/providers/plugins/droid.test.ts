import { describe, expect, it, vi } from 'vitest';
import type { ProviderPluginDeps } from '../types';
import { droidPlugin } from './droid';

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

describe('droidPlugin', () => {
  it('writes hook config to .factory/settings.json', async () => {
    const deps = makeDeps();
    const plugin = droidPlugin(deps);

    const result = await plugin.writeHookConfig?.();

    expect(result).toBe(true);
    expect(deps.writeProjectFile).toHaveBeenCalledWith(
      '.factory/settings.json',
      expect.stringContaining('EMDASH_HOOK_PORT')
    );
  });

  it('includes Notification and Stop hook entries', async () => {
    const deps = makeDeps();
    const plugin = droidPlugin(deps);
    await plugin.writeHookConfig?.();

    const [, content] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    const config = JSON.parse(content) as { hooks: Record<string, unknown[]> };
    expect(config.hooks.Notification).toBeDefined();
    expect(config.hooks.Stop).toBeDefined();
  });

  it('exposes supportsHooks and gitIgnorePaths', () => {
    const plugin = droidPlugin(makeDeps());
    expect(plugin.supportsHooks).toBe(true);
    expect(plugin.gitIgnorePaths).toContain('.factory/settings.json');
  });

  it('has a createClassifier function', () => {
    const plugin = droidPlugin(makeDeps());
    expect(plugin.createClassifier).toBeDefined();
    const classifier = plugin.createClassifier!();
    expect(classifier).toBeDefined();
    expect(typeof classifier.classify).toBe('function');
  });
});
