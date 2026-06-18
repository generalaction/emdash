import type { PluginFs } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { CODEX_HOOKS_PATH, buildCodexHookConfig } from './hooks';

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

type NestedEntry = { matcher?: string; hooks: { type: string; command: string }[] };

async function readHooksJson(fs: PluginFs): Promise<Record<string, NestedEntry[]>> {
  const raw = await fs.read(CODEX_HOOKS_PATH);
  return ((JSON.parse(raw ?? '{}') as { hooks?: Record<string, NestedEntry[]> }).hooks ??
    {}) as Record<string, NestedEntry[]>;
}

describe('buildCodexHookConfig', () => {
  it('registers a PreToolUse hook scoped to the request_user_input tool', async () => {
    const fs = createMemoryFs();
    const hooks = buildCodexHookConfig();

    await hooks.writeHooks(fs, []);

    const installed = await readHooksJson(fs);
    expect(installed.PreToolUse).toHaveLength(1);
    const [entry] = installed.PreToolUse;
    expect(entry.matcher).toBe('request_user_input');
    expect(entry.hooks[0].command).toContain('elicitation_dialog');
    expect(entry.hooks[0].command).toContain('EMDASH_HOOK_PORT');
  });

  it('reports hooks as installed and removes them on delete', async () => {
    const fs = createMemoryFs();
    const hooks = buildCodexHookConfig();

    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    await hooks.writeHooks(fs, []);
    expect(await hooks.getHooksInstalled(fs)).toBe(true);

    await hooks.deleteHooks(fs);
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    const installed = await readHooksJson(fs);
    expect(installed.PreToolUse ?? []).toHaveLength(0);
  });

  it('preserves unrelated user-defined PreToolUse hooks', async () => {
    const userHook: NestedEntry = {
      matcher: 'Bash',
      hooks: [{ type: 'command', command: 'echo hi' }],
    };
    const fs = createMemoryFs({
      [CODEX_HOOKS_PATH]: JSON.stringify({ hooks: { PreToolUse: [userHook] } }),
    });
    const hooks = buildCodexHookConfig();

    await hooks.writeHooks(fs, []);

    const installed = await readHooksJson(fs);
    expect(installed.PreToolUse).toContainEqual(userHook);
    expect(installed.PreToolUse.some((entry) => entry.matcher === 'request_user_input')).toBe(true);
  });

  it('maps an elicitation_dialog notification to an attention notification', () => {
    const { parseHookEvent } = buildCodexHookConfig();

    expect(parseHookEvent('notification', { notification_type: 'elicitation_dialog' })).toEqual({
      kind: 'status',
      type: 'notification',
      notificationType: 'elicitation_dialog',
    });
  });

  it('still maps idle_prompt to a stop event', () => {
    const { parseHookEvent } = buildCodexHookConfig();

    expect(parseHookEvent('notification', { notification_type: 'idle_prompt' })).toEqual({
      kind: 'status',
      type: 'stop',
    });
  });
});
