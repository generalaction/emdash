import type { CommandContext } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

const sessionId = '550e8400-e29b-41d4-a716-446655440000';
const allowFlag = '--allow-dangerously-skip-permissions';
const bypassFlag = '--dangerously-skip-permissions';

function build(context: Partial<CommandContext> = {}) {
  return provider.behavior.prompt!.buildCommand({
    cli: 'claude',
    autoApprove: false,
    initialPrompt: 'Start here',
    sessionId,
    isResuming: false,
    model: '',
    canToggleBypassPermissions: true,
    ...context,
  });
}

describe('Claude prompt command', () => {
  it('starts a restricted fresh session with the bypass mode switch available', () => {
    const command = build();

    expect(command).toEqual({
      command: 'claude',
      args: [allowFlag, '--session-id', sessionId, 'Start here'],
      env: {},
    });
    expect(command.args).not.toContain(bypassFlag);
  });

  it('starts an auto-approved fresh session directly in bypass mode', () => {
    const command = build({ autoApprove: true });

    expect(command.args).toEqual(['--session-id', sessionId, bypassFlag, 'Start here']);
    expect(command.args).not.toContain(allowFlag);
  });

  it('resumes a restricted session with the bypass mode switch available', () => {
    const command = build({ isResuming: true });

    expect(command.args).toEqual([allowFlag, '--resume', sessionId]);
    expect(command.args).not.toContain(bypassFlag);
    expect(command.args).not.toContain('Start here');
  });

  it('resumes an auto-approved session directly in bypass mode', () => {
    const command = build({ autoApprove: true, isResuming: true });

    expect(command.args).toEqual(['--resume', sessionId, bypassFlag]);
    expect(command.args).not.toContain(allowFlag);
    expect(command.args).not.toContain('Start here');
  });

  it.each([false, undefined])(
    'keeps restricted mode unchanged when the host capability is %s',
    (canToggleBypassPermissions) => {
      const command = build({ canToggleBypassPermissions });

      expect(command.args).toEqual(['--session-id', sessionId, 'Start here']);
      expect(command.args).not.toContain(allowFlag);
      expect(command.args).not.toContain(bypassFlag);
    }
  );

  it('deduplicates a user-configured allow flag against the generated capability flag', () => {
    const command = build({ extraArgs: [allowFlag] });

    expect(command.args.filter((arg) => arg === allowFlag)).toHaveLength(1);
  });

  it('does not add PTY permission flags to the ACP spawn', () => {
    const spawn = provider.behavior.acp!.buildSpawn({
      cli: '/usr/local/bin/claude',
      cwd: '/tmp/worktree',
      env: {},
    });

    expect(spawn.args).not.toContain(allowFlag);
    expect(spawn.args).not.toContain(bypassFlag);
  });
});
