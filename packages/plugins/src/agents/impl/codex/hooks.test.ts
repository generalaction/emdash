import type { PluginFs } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { CODEX_CONFIG_PATH, buildCodexHookConfig } from './hooks';

const CODEX_LEGACY_HOOKS_PATH = '.codex/hooks.json';

function createMemoryFs(initial: Record<string, string> = {}): PluginFs & {
  files: Map<string, string>;
} {
  const files = new Map(Object.entries(initial));

  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async delete(path) {
      files.delete(path);
    },
    async exists(path) {
      return files.has(path);
    },
    async list(path) {
      return [...files.keys()].filter((file) => file.startsWith(path));
    },
  };
}

describe('buildCodexHookConfig', () => {
  it('writes Codex hooks to config.toml and removes legacy hooks.json', async () => {
    const fs = createMemoryFs({
      [CODEX_CONFIG_PATH]: 'model = "gpt-5"\n',
      [CODEX_LEGACY_HOOKS_PATH]: JSON.stringify(
        {
          hooks: {
            Stop: [
              {
                hooks: [
                  {
                    type: 'command',
                    command: 'curl http://127.0.0.1:$EMDASH_HOOK_PORT/hook',
                  },
                ],
              },
              {
                hooks: [{ type: 'command', command: 'echo user-stop' }],
              },
            ],
            UserPromptSubmit: [
              {
                hooks: [{ type: 'command', command: 'echo user-prompt' }],
              },
            ],
          },
        },
        null,
        2
      ),
    });
    const hooks = buildCodexHookConfig();

    await expect(hooks.writeHooks(fs, [])).resolves.toEqual([CODEX_CONFIG_PATH]);

    await expect(fs.exists(CODEX_LEGACY_HOOKS_PATH)).resolves.toBe(false);
    const config = await fs.read(CODEX_CONFIG_PATH);
    expect(config).toContain('model = "gpt-5"');
    expect(config).toContain('echo user-stop');
    expect(config).toContain('echo user-prompt');
    expect(config).toContain('notification_type');
    expect(config).toContain('session-start');
  });

  it('deletes Emdash hooks from both current and legacy Codex hook config', async () => {
    const emdashHook = {
      hooks: [
        {
          type: 'command',
          command: 'curl http://127.0.0.1:$EMDASH_HOOK_PORT/hook',
        },
      ],
    };
    const userHook = {
      hooks: [{ type: 'command', command: 'echo user-stop' }],
    };
    const fs = createMemoryFs({
      [CODEX_CONFIG_PATH]: `[[hooks.Stop]]
hooks = [{ type = "command", command = "curl http://127.0.0.1:$EMDASH_HOOK_PORT/hook" }]

[[hooks.Stop]]
hooks = [{ type = "command", command = "echo user-toml" }]
`,
      [CODEX_LEGACY_HOOKS_PATH]: JSON.stringify({
        hooks: {
          Stop: [emdashHook, userHook],
        },
      }),
    });
    const hooks = buildCodexHookConfig();

    await hooks.deleteHooks(fs);

    const config = await fs.read(CODEX_CONFIG_PATH);
    expect(config).not.toContain('EMDASH_HOOK_PORT');
    expect(config).toContain('echo user-toml');
    const legacy = await fs.read(CODEX_LEGACY_HOOKS_PATH);
    expect(legacy).toContain('echo user-stop');
    expect(legacy).not.toContain('EMDASH_HOOK_PORT');
  });
});
