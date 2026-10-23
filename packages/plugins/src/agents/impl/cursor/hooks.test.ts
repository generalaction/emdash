import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { buildCursorHookConfig, CURSOR_HOOKS_PATH, parseCursorHookEvent } from './hooks';
import { provider } from './index';

function createFs(initial: Record<string, unknown> = {}) {
  const files = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value, null, 2) + '\n'])
  );
  const fs: PluginFs = {
    read: async (key) => files.get(key) ?? null,
    write: async (key, value) => {
      files.set(key, value);
    },
    delete: async (key) => {
      files.delete(key);
    },
    exists: async (key) => files.has(key),
    list: async () => [],
  };
  const read = (key: string) => JSON.parse(files.get(key)!);
  return { fs, files, read };
}

const SESSION_ID = 'conv-cursor-1';

describe('Cursor hooks', () => {
  const hooks = buildCursorHookConfig({ platform: 'linux' });

  it('declares session/start/stop so Enter no longer owns the working spinner', () => {
    expect(provider.capabilities.hooks).toEqual({
      kind: 'config',
      scope: 'global',
      supportedEvents: ['session', 'start', 'stop'],
    });
    expect(hooks.resolveConfigRoots({ homeDir: '/home/user', env: {}, platform: 'linux' })).toEqual(
      ['/home/user/.cursor']
    );
  });

  it('installs flat ~/.cursor/hooks.json entries with version 1', async () => {
    const { fs, read } = createFs();
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    expect(await hooks.writeHooks(fs, [])).toEqual([CURSOR_HOOKS_PATH]);

    const config = read(CURSOR_HOOKS_PATH);
    expect(config.version).toBe(1);
    expect(config.hooks.sessionStart).toHaveLength(1);
    expect(config.hooks.beforeSubmitPrompt).toHaveLength(1);
    expect(config.hooks.stop).toHaveLength(1);
    expect(config.hooks.beforeSubmitPrompt[0].command).toContain('EMDASH_HOOK_PORT');
    expect(config.hooks.beforeSubmitPrompt[0].command).toContain('"continue":true');
    expect(config.hooks.stop[0].command).toContain('printf');
    expect(await hooks.getHooksInstalled(fs)).toBe(true);
  });

  it('installs Windows commands without a POSIX wrapper', async () => {
    const { fs, read } = createFs();
    await buildCursorHookConfig({ platform: 'win32' }).writeHooks(fs, []);
    for (const event of ['sessionStart', 'beforeSubmitPrompt', 'stop'] as const) {
      const command = read(CURSOR_HOOKS_PATH).hooks[event][0].command;
      expect(command).toMatch(/^cmd\.exe .* -EncodedCommand [A-Za-z0-9+/]+=*$/);
      expect(command).not.toContain('/dev/null');
      expect(command).not.toContain('printf');
      const script = Buffer.from(command.split(' -EncodedCommand ')[1], 'base64').toString(
        'utf16le'
      );
      expect(script).toContain('X-Emdash-Event-Type');
      if (event === 'beforeSubmitPrompt') {
        expect(script).toContain('"continue":true');
      }
    }
  });

  it('preserves user hooks while replacing managed emdash entries', async () => {
    const { fs, read } = createFs({
      [CURSOR_HOOKS_PATH]: {
        version: 1,
        hooks: {
          afterFileEdit: [{ type: 'command', command: './hooks/format.sh' }],
          stop: [{ type: 'command', command: 'echo EMDASH_HOOK_PORT stale' }],
        },
      },
    });

    await hooks.writeHooks(fs, []);
    const config = read(CURSOR_HOOKS_PATH);
    expect(config.hooks.afterFileEdit).toEqual([{ type: 'command', command: './hooks/format.sh' }]);
    expect(config.hooks.stop).toHaveLength(1);
    expect(config.hooks.stop[0].command).toContain('X-Emdash-Event-Type: stop');
    expect(config.hooks.stop[0].command).not.toContain('stale');
  });

  it('maps Cursor conversation ids onto status and session events', () => {
    expect(
      parseCursorHookEvent('start', {
        conversation_id: SESSION_ID,
        hook_event_name: 'beforeSubmitPrompt',
        prompt: 'fix the spinner',
      })
    ).toEqual({
      kind: 'status',
      type: 'start',
      providerSessionId: SESSION_ID,
    });

    expect(
      parseCursorHookEvent('session-start', {
        session_id: SESSION_ID,
        conversation_id: SESSION_ID,
        hook_event_name: 'sessionStart',
      })
    ).toEqual({ kind: 'session', providerSessionId: SESSION_ID });
  });

  it('maps stop statuses, including errors', () => {
    expect(
      parseCursorHookEvent('stop', {
        conversation_id: SESSION_ID,
        status: 'completed',
        loop_count: 0,
      })
    ).toEqual({
      kind: 'status',
      type: 'stop',
      providerSessionId: SESSION_ID,
    });

    expect(
      parseCursorHookEvent('stop', {
        conversation_id: SESSION_ID,
        status: 'aborted',
        loop_count: 0,
      })
    ).toEqual({
      kind: 'status',
      type: 'stop',
      providerSessionId: SESSION_ID,
    });

    expect(
      parseCursorHookEvent('stop', {
        conversation_id: SESSION_ID,
        status: 'error',
        message: 'boom',
      })
    ).toEqual({
      kind: 'status',
      type: 'error',
      providerSessionId: SESSION_ID,
      message: 'boom',
    });
  });
});
