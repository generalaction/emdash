import { describe, expect, it, vi } from 'vitest';
import type { ProviderPluginDeps } from '../types';
import { openCodePlugin } from './opencode';

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

describe('openCodePlugin', () => {
  it('writes the plugin file to .opencode/plugins/emdash-notifications.js', async () => {
    const deps = makeDeps();
    const plugin = openCodePlugin(deps);

    const result = await plugin.writeHookConfig?.();

    expect(result).toBe(true);
    expect(deps.writeProjectFile).toHaveBeenCalledWith(
      '.opencode/plugins/emdash-notifications.js',
      expect.stringContaining('EMDASH_HOOK_PORT')
    );
  });

  it('skips write when existing content matches', async () => {
    const deps = makeDeps();
    const plugin = openCodePlugin(deps);

    await plugin.writeHookConfig?.();
    const [, writtenContent] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string];

    (deps.writeProjectFile as ReturnType<typeof vi.fn>).mockClear();
    (deps.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(writtenContent);

    const result = await plugin.writeHookConfig?.();
    expect(result).toBe(true);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });

  it('exposes gitIgnorePaths', () => {
    const plugin = openCodePlugin(makeDeps());
    expect(plugin.gitIgnorePaths).toContain('.opencode/plugins/emdash-notifications.js');
  });

  it('has a createClassifier function', () => {
    const plugin = openCodePlugin(makeDeps());
    expect(plugin.createClassifier).toBeDefined();
    const classifier = plugin.createClassifier!();
    expect(typeof classifier.classify).toBe('function');
  });
});
