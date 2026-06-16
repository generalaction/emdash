import type { PluginFs } from '@emdash/shared/agents/plugins';
import { describe, expect, it } from 'vitest';
import { COMMANDCODE_SETTINGS_PATH } from './hooks';
import { provider } from './index';

const baseContext = {
  cli: 'cmd',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('commandcode provider', () => {
  it('starts a fresh session without resume flags', () => {
    const command = provider.behavior.prompt!.buildCommand(baseContext);

    expect(command).toEqual({
      command: 'cmd',
      args: ['--trust', '--skip-onboarding'],
      env: {},
    });
  });

  it('resumes a stored provider session id with --resume', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      providerSessionId: 'command-session-id',
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'cmd',
      args: ['--trust', '--skip-onboarding', '--resume', 'command-session-id'],
      env: {},
    });
  });

  it('installs a Stop hook that reports the Command Code session id', async () => {
    const files = new Map<string, string>();
    const fs: PluginFs = {
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

    await provider.behavior.hooks!.writeHooks(fs, []);

    const settings = JSON.parse(files.get(COMMANDCODE_SETTINGS_PATH)!);
    expect(settings.hooks.Stop).toHaveLength(1);
    expect(JSON.stringify(settings.hooks.Stop)).toContain('EMDASH_HOOK_PORT');
    expect(JSON.stringify(settings.hooks.Stop)).toContain('X-Emdash-Event-Type: session');
  });
});
