import type { PluginFs } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { DROID_HOOKS_PATH } from './hooks';
import { provider } from './index';

function createMemoryFs(files = new Map<string, string>()): PluginFs {
  return {
    read: async (path) => files.get(path) ?? null,
    write: async (path, content) => {
      files.set(path, content);
    },
    delete: async (path) => {
      files.delete(path);
    },
    exists: async (path) => files.has(path),
    list: async () => [],
  };
}

describe('droid provider hooks', () => {
  it('writes hooks to the documented Factory hooks path', async () => {
    const files = new Map<string, string>();
    const fs = createMemoryFs(files);

    await provider.behavior.hooks!.writeHooks(fs, []);

    expect(files.has('.factory/settings.json')).toBe(false);
    const raw = files.get(DROID_HOOKS_PATH);
    expect(raw).toBeDefined();
    const config = JSON.parse(raw!) as Record<string, Record<string, unknown[]>>;
    expect(config.hooks.Notification).toHaveLength(1);
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(JSON.stringify(config.hooks.Notification)).toContain('notification');
    expect(JSON.stringify(config.hooks.Stop)).toContain('stop');
    expect(JSON.stringify(config.hooks.SessionStart)).toContain('session');
  });
});
