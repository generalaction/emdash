import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { makeStdinHookCommand } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { describe, expect, it } from 'vitest';
import { buildMuseHookConfig, MUSE_HOOK_ENV_VARS, MUSE_HOOKS_PATH } from './hooks';
import { provider } from './index';

function createFs(initial: Record<string, unknown> = {}) {
  const files = new Map(
    Object.entries(initial).map(([name, value]) => [name, JSON.stringify(value)])
  );
  const fs: PluginFs = {
    read: async (name) => files.get(name) ?? null,
    write: async (name, value) => {
      files.set(name, value);
    },
    delete: async (name) => {
      files.delete(name);
    },
    exists: async (name) => files.has(name),
    list: async () => [],
  };
  const read = (name: string) => JSON.parse(files.get(name)!);
  return { fs, files, read };
}

describe('Muse hooks', () => {
  const hooks = buildMuseHookConfig();

  it('declares explicit start and completion hooks', () => {
    expect(provider.capabilities.hooks).toEqual({
      kind: 'config',
      scope: 'global',
      supportedEvents: ['session', 'start', 'stop'],
    });
    expect(
      hooks.resolveConfigRoots({
        env: { XDG_CONFIG_HOME: '/custom/config' },
        homeDir: '/home/user',
        platform: 'linux',
      })
    ).toEqual(['/custom/config/muse']);
    expect(
      hooks.resolveConfigRoots({
        env: {},
        homeDir: '/Users/user',
        platform: 'macos',
      })
    ).toEqual(['/Users/user/.config/muse']);
  });

  it('installs managed hooks and the routing allowlist idempotently', async () => {
    const { fs, files, read } = createFs();
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    expect(await hooks.writeHooks(fs)).toEqual([MUSE_HOOKS_PATH, 'settings.json']);
    expect(read('settings.json')).toEqual({
      schema_version: 1,
      managed_hooks_path: MUSE_HOOKS_PATH,
      managed_hooks_env_vars: ['EMDASH_HOOK_PORT', 'EMDASH_HOOK_NONCE', 'EMDASH_PTY_ID'],
    });
    expect(Object.keys(read(MUSE_HOOKS_PATH).hooks)).toEqual([
      'SessionStart',
      'UserPromptSubmit',
      'Stop',
    ]);
    expect(await hooks.getHooksInstalled(fs)).toBe(true);
    expect(read(MUSE_HOOKS_PATH).hooks.UserPromptSubmit).toEqual([
      { hooks: [{ type: 'command', command: makeStdinHookCommand('start') }] },
    ]);
    expect([...files.keys()].sort()).toEqual([MUSE_HOOKS_PATH, 'settings.json']);
    const first = new Map(files);
    await hooks.writeHooks(fs);
    expect(files).toEqual(first);
  });

  it('preserves existing managed and ordinary hooks, settings, and environment names', async () => {
    const userHook = { hooks: [{ type: 'command', command: 'echo user-hook' }] };
    const { fs, read } = createFs({
      'settings.json': {
        schema_version: 1,
        model: 'existing-model',
        managed_hooks_path: 'team-hooks.json',
        managed_hooks_env_vars: ['TEAM_VARIABLE'],
        hooks: { Stop: [userHook] },
      },
      'team-hooks.json': { hooks: { Stop: [userHook] }, custom: true },
    });
    await hooks.writeHooks(fs);
    expect(read('settings.json')).toMatchObject({
      model: 'existing-model',
      managed_hooks_path: 'team-hooks.json',
      hooks: { Stop: [userHook] },
      managed_hooks_env_vars: ['TEAM_VARIABLE', ...MUSE_HOOK_ENV_VARS],
    });
    expect(read('team-hooks.json').hooks.Stop).toHaveLength(2);
    await hooks.deleteHooks(fs);
    expect(read('team-hooks.json')).toMatchObject({ custom: true, hooks: { Stop: [userHook] } });
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
  });

  it('repairs missing allowlist entries and hook commands', async () => {
    const { fs, files, read } = createFs();
    await hooks.writeHooks(fs);
    const settings = read('settings.json');
    settings.managed_hooks_env_vars = [];
    files.set('settings.json', JSON.stringify(settings));
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    await hooks.writeHooks(fs);
    const config = read(MUSE_HOOKS_PATH);
    config.hooks.Stop = [];
    files.set(MUSE_HOOKS_PATH, JSON.stringify(config));
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    await hooks.writeHooks(fs);
    expect(await hooks.getHooksInstalled(fs)).toBe(true);
  });

  it.each([
    { schema_version: 2 },
    { managed_hooks_env_vars: 'invalid' },
    { managed_hooks_path: '/etc/muse/hooks.json' },
    { managed_hooks_path: '../hooks.json' },
    { managed_hooks_path: 'C:\\hooks.json' },
    { managed_hooks_path: 'settings.json' },
  ])('leaves incompatible settings untouched: %j', async (settings) => {
    const { fs, files } = createFs({ 'settings.json': settings });
    const before = new Map(files);
    await expect(hooks.writeHooks(fs)).rejects.toThrow();
    expect(files).toEqual(before);
  });

  it('leaves malformed hook files untouched', async () => {
    const { fs, files } = createFs({ 'settings.json': { schema_version: 1 } });
    files.set(MUSE_HOOKS_PATH, '{broken');
    const before = new Map(files);
    await expect(hooks.writeHooks(fs)).rejects.toThrow();
    expect(files).toEqual(before);
  });

  it('accepts native Stop without a turn id after successive tagged prompts', () => {
    const hooks = buildMuseHookConfig();
    for (const turnId of ['first', 'second']) {
      expect(
        hooks.parseHookEvent('start', {
          session_id: 'session',
          turn_id: turnId,
          hook_event_name: 'UserPromptSubmit',
        })
      ).toMatchObject({ kind: 'status', type: 'start', providerSessionId: 'session' });
      expect(
        hooks.parseHookEvent('stop', {
          session_id: 'session',
          hook_event_name: 'Stop',
          stop_hook_active: false,
          last_assistant_message: 'finished',
        })
      ).toMatchObject({
        kind: 'status',
        type: 'stop',
        providerSessionId: 'session',
        lastAssistantMessage: 'finished',
      });
    }
  });

  it('maps verified Muse payloads to session, working, and completion events', () => {
    const sessionId = '01a0a6a1-dcc2-7a11-bccf-a6b774e17021';
    expect(hooks.parseHookEvent('session-start', { session_id: sessionId })).toEqual({
      kind: 'session',
      providerSessionId: sessionId,
    });
    expect(
      hooks.parseHookEvent('start', { session_id: sessionId, hook_event_name: 'UserPromptSubmit' })
    ).toMatchObject({ kind: 'status', type: 'start', providerSessionId: sessionId });
    expect(
      hooks.parseHookEvent('stop', {
        session_id: sessionId,
        hook_event_name: 'Stop',
        stop_hook_active: false,
        last_assistant_message: 'finished',
      })
    ).toMatchObject({
      kind: 'status',
      type: 'stop',
      providerSessionId: sessionId,
      lastAssistantMessage: 'finished',
    });
    expect(hooks.parseHookEvent('SubagentStop', {})).toEqual({ kind: 'ignore' });
  });
});
