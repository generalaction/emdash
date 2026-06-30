import type { PluginFs } from '@emdash/core/agents/plugins';
import { buildNestedEntry, makeStdinHookCommand } from '@emdash/core/agents/plugins/helpers';
import { describe, expect, it } from 'vitest';
import { QODER_SETTINGS_PATH } from './hooks';
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

describe('qoder provider', () => {
  it('declares workspace config hooks', () => {
    expect(provider.capabilities.hooks).toEqual({
      kind: 'config',
      scope: 'workspace',
      supportedEvents: ['notification', 'stop', 'session', 'start', 'tool-use', 'tool-use-failure'],
    });
  });

  it('installs Qoder lifecycle hooks in project-local settings', async () => {
    const files = new Map<string, string>();
    const fs = createMemoryFs(files);

    await provider.behavior.hooks!.writeHooks(fs, []);

    const settings = JSON.parse(files.get(QODER_SETTINGS_PATH)!);
    expect(settings.hooks.SessionStart).toEqual([
      buildNestedEntry(makeStdinHookCommand('session')),
    ]);
    expect(settings.hooks.UserPromptSubmit).toEqual([
      buildNestedEntry(makeStdinHookCommand('start')),
    ]);
    expect(settings.hooks.PermissionRequest).toEqual([
      buildNestedEntry(makeStdinHookCommand('notification')),
    ]);
    expect(settings.hooks.Notification).toEqual([
      buildNestedEntry(makeStdinHookCommand('notification')),
    ]);
    expect(settings.hooks.Stop).toEqual([buildNestedEntry(makeStdinHookCommand('stop'))]);

    const hooksJson = JSON.stringify(settings.hooks);
    expect(hooksJson).toContain('EMDASH_HOOK_NONCE');
    expect(hooksJson).toContain('EMDASH_HOOK_PORT');
  });

  it('maps PermissionRequest hooks to permission notifications', () => {
    const event = provider.behavior.hooks!.parseHookEvent!('notification', {
      hook_event_name: 'PermissionRequest',
      tool_name: 'Bash',
    });

    expect(event).toEqual({
      kind: 'status',
      type: 'notification',
      notificationType: 'permission_prompt',
      title: 'Permission Required',
      message: 'Qoder CLI is requesting permission to use Bash.',
    });
  });
});
