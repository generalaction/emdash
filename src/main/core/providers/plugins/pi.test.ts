import { describe, expect, it, vi } from 'vitest';
import type { ProviderPluginDeps } from '../types';
import { piPlugin } from './pi';

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

describe('piPlugin', () => {
  it('writes the extension file to .pi/extensions/emdash-hook.ts', async () => {
    const deps = makeDeps();
    const plugin = piPlugin(deps);

    const result = await plugin.writeHookConfig?.();

    expect(result).toBe(true);
    expect(deps.writeProjectFile).toHaveBeenCalledWith(
      '.pi/extensions/emdash-hook.ts',
      expect.stringContaining('EMDASH_HOOK_PORT')
    );
  });

  it('skips write when existing content matches', async () => {
    const deps = makeDeps();
    const plugin = piPlugin(deps);

    // First write to capture the content
    await plugin.writeHookConfig?.();
    const [, writtenContent] = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock
      .calls[0] as [string, string];

    // Reset and configure existing file to match
    (deps.writeProjectFile as ReturnType<typeof vi.fn>).mockClear();
    (deps.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(writtenContent);

    const result = await plugin.writeHookConfig?.();
    expect(result).toBe(true);
    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });

  it('exposes gitIgnorePaths', () => {
    const plugin = piPlugin(makeDeps());
    expect(plugin.gitIgnorePaths).toContain('.pi/extensions/emdash-hook.ts');
  });

  it('has a createClassifier function', () => {
    const plugin = piPlugin(makeDeps());
    expect(plugin.createClassifier).toBeDefined();
    const classifier = plugin.createClassifier!();
    expect(typeof classifier.classify).toBe('function');
  });
});
