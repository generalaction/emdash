import { describe, expect, it } from 'vitest';
import type { AgentSessionConfig } from '@shared/agent-session';
import { resolveSshCommand } from './spawn-utils';

function makeAgentConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    taskId: 'task-1',
    conversationId: 'conv-1',
    providerId: 'claude',
    command: 'claude',
    args: ['--resume', 'conv-1'],
    cwd: '/workspace',
    autoApprove: false,
    resume: false,
    ...overrides,
  };
}

describe('resolveSshCommand', () => {
  it('runs remote commands through a login shell so PATH matches install/probe', () => {
    const result = resolveSshCommand('agent', makeAgentConfig());

    expect(result).toBe(`bash -l -c 'cd "/workspace" && claude --resume conv-1'`);
  });

  it('adds SSH env exports before the remote command', () => {
    const result = resolveSshCommand('agent', makeAgentConfig(), {
      FOO: 'bar',
    });

    expect(result).toBe(
      `bash -l -c 'cd "/workspace" && export FOO='\\''bar'\\''; claude --resume conv-1'`
    );
  });

  it('preserves remote tmux wrapping for SSH commands', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig({
        tmuxSessionName: 'agent-session',
      })
    );

    expect(result).toContain('tmux has-session -t "agent-session"');
    expect(result).toContain('tmux new-session -d -s "agent-session"');
    expect(result).toContain('tmux attach-session -t "agent-session"');
    expect(result).toContain('claude --resume conv-1');
  });
});
