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
    expect(config.hooks.UserPromptSubmit).toHaveLength(1);
    expect(config.hooks.Notification).toHaveLength(1);
    expect(config.hooks.Stop).toHaveLength(1);
    expect(config.hooks.SessionStart).toHaveLength(1);
    expect(JSON.stringify(config.hooks.UserPromptSubmit)).toContain('start');
    expect(JSON.stringify(config.hooks.Notification)).toContain('notification');
    expect(JSON.stringify(config.hooks.Stop)).toContain('stop');
    expect(JSON.stringify(config.hooks.SessionStart)).toContain('session');
  });

  it('migrates existing settings.json fallback hooks before creating hooks.json', async () => {
    const userHook = {
      hooks: [{ type: 'command', command: 'echo user-notification' }],
    };
    const files = new Map<string, string>([
      [
        '.factory/settings.json',
        JSON.stringify({
          hooks: {
            Notification: [userHook],
          },
        }),
      ],
    ]);
    const fs = createMemoryFs(files);

    await provider.behavior.hooks!.writeHooks(fs, []);

    const config = JSON.parse(files.get(DROID_HOOKS_PATH)!) as Record<
      string,
      Record<string, unknown[]>
    >;
    expect(config.hooks.Notification).toEqual(
      expect.arrayContaining([userHook, expect.objectContaining({ hooks: expect.any(Array) })])
    );
    expect(JSON.stringify(config.hooks.Notification)).toContain('notification');
  });

  it('removes managed hooks from hooks.json and legacy settings.json', async () => {
    const userHook = {
      hooks: [{ type: 'command', command: 'echo user-notification' }],
    };
    const fs = createMemoryFs(
      new Map<string, string>([
        [
          DROID_HOOKS_PATH,
          JSON.stringify({
            hooks: {
              Notification: [userHook],
            },
          }),
        ],
        [
          '.factory/settings.json',
          JSON.stringify({
            hooks: {
              UserPromptSubmit: [
                userHook,
                {
                  hooks: [{ type: 'command', command: 'echo EMDASH_HOOK_PORT && echo stale' }],
                },
              ],
            },
          }),
        ],
      ])
    );

    await provider.behavior.hooks!.writeHooks(fs, []);
    await provider.behavior.hooks!.deleteHooks(fs);

    const hooksConfig = JSON.parse((await fs.read(DROID_HOOKS_PATH))!) as Record<
      string,
      Record<string, unknown[]>
    >;
    const settingsConfig = JSON.parse((await fs.read('.factory/settings.json'))!) as Record<
      string,
      Record<string, unknown[]>
    >;

    expect(hooksConfig.hooks.Notification).toEqual([userHook]);
    expect(JSON.stringify(hooksConfig)).not.toContain('EMDASH_HOOK_PORT');
    expect(settingsConfig.hooks.UserPromptSubmit).toEqual([userHook]);
    expect(JSON.stringify(settingsConfig)).not.toContain('EMDASH_HOOK_PORT');
  });
});
