import type { PluginFs } from '@emdash/core/agents/plugins';
import { buildNestedEntry, makeStdinHookCommand } from '@emdash/core/agents/plugins/helpers';
import { describe, expect, it } from 'vitest';
import { GOOSE_HOOKS_PATH, GOOSE_PLUGIN_MANIFEST_PATH } from './hooks';
import { provider } from './index';

const baseContext = {
  cli: 'goose',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-conversation-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

function createMemoryFs(files = new Map<string, string>()): PluginFs & {
  files: Map<string, string>;
} {
  return {
    files,
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

describe('goose provider', () => {
  it('starts an empty named interactive session without using run', () => {
    const command = provider.behavior.prompt!.buildCommand(baseContext);

    expect(command).toEqual({
      command: 'goose',
      args: ['session', '-n', 'emdash-conversation-id'],
      env: {},
    });
  });

  it('starts a named interactive run with the initial prompt', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'Fix the bug',
    });

    expect(command).toEqual({
      command: 'goose',
      args: ['run', '-s', '-n', 'emdash-conversation-id', '-t', 'Fix the bug'],
      env: {},
    });
  });

  it('resumes the stored Goose session id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      providerSessionId: 'goose-session-id',
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'goose',
      args: ['session', '--resume', '--session-id', 'goose-session-id'],
      env: {},
    });
  });

  it('starts fresh when resuming without a stored Goose session id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'goose',
      args: ['session', '-n', 'emdash-conversation-id'],
      env: {},
    });
  });

  it('writes an Open Plugins hook plugin for Goose', async () => {
    const fs = createMemoryFs();

    await expect(provider.behavior.hooks!.writeHooks(fs, [])).resolves.toEqual([
      GOOSE_PLUGIN_MANIFEST_PATH,
      GOOSE_HOOKS_PATH,
    ]);

    expect(JSON.parse(fs.files.get(GOOSE_PLUGIN_MANIFEST_PATH)!)).toEqual({
      name: 'emdash',
      version: '0.1.0',
      description: 'Emdash lifecycle hooks for Goose sessions',
    });

    const hooksConfig = JSON.parse(fs.files.get(GOOSE_HOOKS_PATH)!);
    expect(hooksConfig.hooks.SessionStart).toEqual([
      buildNestedEntry(makeStdinHookCommand('session')),
    ]);
    expect(hooksConfig.hooks.UserPromptSubmit).toEqual([
      buildNestedEntry(makeStdinHookCommand('start')),
    ]);
    expect(hooksConfig.hooks.PreToolUse).toEqual([buildNestedEntry(makeStdinHookCommand('start'))]);
    expect(hooksConfig.hooks.PostToolUseFailure).toEqual([
      buildNestedEntry(makeStdinHookCommand('error')),
    ]);
    expect(hooksConfig.hooks.SessionEnd).toEqual([buildNestedEntry(makeStdinHookCommand('stop'))]);
  });

  it('preserves user Goose hook entries while replacing managed entries', async () => {
    const userEntry = {
      hooks: [{ type: 'command', command: '${PLUGIN_ROOT}/scripts/user-hook.sh' }],
    };
    const staleManagedEntry = buildNestedEntry('echo EMDASH_HOOK_PORT stale');
    const fs = createMemoryFs(
      new Map([
        [
          GOOSE_HOOKS_PATH,
          JSON.stringify({
            hooks: {
              SessionEnd: [userEntry, staleManagedEntry],
            },
          }),
        ],
      ])
    );

    await provider.behavior.hooks!.writeHooks(fs, []);

    const hooksConfig = JSON.parse(fs.files.get(GOOSE_HOOKS_PATH)!);
    expect(hooksConfig.hooks.SessionEnd).toEqual([
      userEntry,
      buildNestedEntry(makeStdinHookCommand('stop')),
    ]);
  });

  it('treats partial Goose hook installs as incomplete', async () => {
    const fs = createMemoryFs(
      new Map([
        [
          GOOSE_HOOKS_PATH,
          JSON.stringify({
            hooks: {
              SessionStart: [buildNestedEntry(makeStdinHookCommand('session'))],
            },
          }),
        ],
      ])
    );

    await expect(provider.behavior.hooks!.getHooksInstalled(fs)).resolves.toBe(false);

    await provider.behavior.hooks!.writeHooks(fs, []);

    await expect(provider.behavior.hooks!.getHooksInstalled(fs)).resolves.toBe(true);
  });
});
