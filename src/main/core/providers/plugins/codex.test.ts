import { describe, expect, it, vi } from 'vitest';
import type { ProviderPluginDeps } from '../types';
import { codexPlugin } from './codex';

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

describe('codexPlugin', () => {
  it('writes hook config to .codex/hooks.json in user home', async () => {
    const deps = makeDeps();
    const plugin = codexPlugin(deps);

    const result = await plugin.writeHookConfig?.();

    expect(result).toBe(true);
    expect(deps.writeUserFile).toHaveBeenCalledWith(
      '.codex/hooks.json',
      expect.stringContaining('EMDASH_HOOK_PORT')
    );
  });

  it('includes Stop and PermissionRequest hook entries', async () => {
    const deps = makeDeps();
    const plugin = codexPlugin(deps);
    await plugin.writeHookConfig?.();

    const [, content] = (deps.writeUserFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    const config = JSON.parse(content) as { hooks: Record<string, unknown[]> };
    expect(config.hooks.Stop).toBeDefined();
    expect(config.hooks.PermissionRequest).toBeDefined();
  });

  it('exposes supportsHooks and no gitIgnorePaths', () => {
    const plugin = codexPlugin(makeDeps());
    expect(plugin.supportsHooks).toBe(true);
    expect(plugin.gitIgnorePaths).toBeUndefined();
  });

  it('removes legacy bash notify entry from project config.toml', async () => {
    const legacyToml = [
      'notify = ["bash", "-c", "curl -sf -X POST -H \'Content-Type: application/json\' -H \\"X-Emdash-Token: $EMDASH_HOOK_TOKEN\\" -H \\"X-Emdash-Pty-Id: $EMDASH_PTY_ID\\" -H \\"X-Emdash-Event-Type: notification\\" -d \\"$1\\" \\"http://127.0.0.1:$EMDASH_HOOK_PORT/hook\\" || true", "_"]',
    ].join('\n');

    const deps = makeDeps({ readProjectFile: vi.fn().mockResolvedValue(legacyToml) });
    const plugin = codexPlugin(deps);
    await plugin.writeHookConfig?.();

    const writeCalls = (deps.writeProjectFile as ReturnType<typeof vi.fn>).mock.calls as [
      string,
      string,
    ][];
    const writeCall = writeCalls.find(([path]) => path === '.codex/config.toml');
    expect(writeCall).toBeDefined();
    expect(writeCall?.[1]).not.toContain('notify');
  });

  it('does not touch config.toml if no legacy notify entry is present', async () => {
    const normalToml = 'model = "o4-mini"\n';
    const deps = makeDeps({ readProjectFile: vi.fn().mockResolvedValue(normalToml) });
    const plugin = codexPlugin(deps);
    await plugin.writeHookConfig?.();

    expect(deps.writeProjectFile).not.toHaveBeenCalled();
  });
});
