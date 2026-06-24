import type { PluginFs } from '@emdash/core/agents/plugins';
import { EMDASH_MARKER } from '@emdash/core/agents/plugins/helpers';
import { describe, expect, it } from 'vitest';
import { COPILOT_HOOKS_PATH, buildCopilotHookConfig } from './hooks';

function createMemoryFs(initial: Record<string, string> = {}): PluginFs {
  const files = new Map(Object.entries(initial));

  return {
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

function copilotConfigWithHooks(hookKeys: string[]): string {
  return JSON.stringify({
    hooks: Object.fromEntries(
      hookKeys.map((hookKey) => [
        hookKey,
        [
          {
            type: 'command',
            command: 'curl http://127.0.0.1:$EMDASH_HOOK_PORT/hook',
          },
        ],
      ])
    ),
  });
}

describe('buildCopilotHookConfig', () => {
  it('does not treat partial managed hook installs as installed', async () => {
    const fs = createMemoryFs({
      [COPILOT_HOOKS_PATH]: copilotConfigWithHooks([
        'agentStop',
        'sessionStart',
        'permissionRequest',
      ]),
    });
    const hooks = buildCopilotHookConfig();

    await expect(hooks.getHooksInstalled(fs)).resolves.toBe(false);
    await expect(hooks.readHooks(fs)).resolves.toEqual([]);
  });

  it('treats a complete managed hook install as installed', async () => {
    const fs = createMemoryFs({
      [COPILOT_HOOKS_PATH]: copilotConfigWithHooks([
        'agentStop',
        'sessionEnd',
        'sessionStart',
        'userPromptSubmitted',
        'errorOccurred',
        'notification',
        'permissionRequest',
      ]),
    });
    const hooks = buildCopilotHookConfig();

    await expect(hooks.getHooksInstalled(fs)).resolves.toBe(true);
    await expect(hooks.readHooks(fs)).resolves.toEqual([
      { event: 'emdash', command: EMDASH_MARKER },
    ]);
  });
});
