import { describe, expect, it } from 'vitest';
import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import type { RemoteShellProfile } from '@main/core/ssh/remote-shell-profile';
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

function makeGeneralConfig(overrides: Partial<GeneralSessionConfig> = {}): GeneralSessionConfig {
  return {
    taskId: 'task-1',
    cwd: '/workspace',
    ...overrides,
  };
}

const zshProfile: RemoteShellProfile = {
  shell: '/bin/zsh',
  env: {
    PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
  },
};

describe('resolveSshCommand', () => {
  it('runs remote commands through a login shell so PATH matches install/probe', () => {
    const result = resolveSshCommand('agent', makeAgentConfig(), undefined, zshProfile);

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd "/workspace" && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
    );
  });

  it('adds SSH env exports before the remote command', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig(),
      {
        FOO: 'bar',
      },
      zshProfile
    );

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export FOO='\\''bar'\\''; cd "/workspace" && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
    );
  });

  it('uses the shared remote shell command builder for fallback SSH commands', () => {
    const result = resolveSshCommand('agent', makeAgentConfig(), {
      FOO: 'bar',
    });

    expect(result).toBe(
      `'/bin/sh' -c 'export FOO='\\''bar'\\''; cd "/workspace" && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
    );
  });

  it('quotes remote agent argv tokens independently', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig({
        command: 'caffeinate',
        args: ['-i', 'direnv', 'exec', '.', '/opt/Claude Code/bin/claude', 'Fix the bug'],
      }),
      undefined,
      zshProfile
    );

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd "/workspace" && '\\''caffeinate'\\'' '\\''-i'\\'' '\\''direnv'\\'' '\\''exec'\\'' '\\''.'\\'' '\\''/opt/Claude Code/bin/claude'\\'' '\\''Fix the bug'\\'''`
    );
  });

  it('preserves remote tmux wrapping for SSH commands', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig({
        tmuxSessionName: 'agent-session',
      }),
      undefined,
      zshProfile
    );

    expect(result).toContain('tmux has-session -t "agent-session"');
    expect(result).toContain('tmux new-session -d -s "agent-session"');
    expect(result).toContain('tmux attach-session -t "agent-session"');
    expect(result).toContain("'\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\''");
  });

  it('launches remote general terminals with the captured remote shell', () => {
    const result = resolveSshCommand('general', makeGeneralConfig(), undefined, zshProfile);

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd "/workspace" && exec /bin/zsh -il'`
    );
  });
});
