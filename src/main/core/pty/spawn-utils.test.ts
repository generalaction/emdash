import { describe, expect, it } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
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
    SHELL: '/bin/zsh',
  },
};

describe('resolveSshCommand', () => {
  it('runs remote commands through a login shell so PATH matches install/probe', () => {
    const result = resolveSshCommand('agent', makeAgentConfig(), undefined, zshProfile);

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''/bin/zsh'\\''; cd "/workspace" && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
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
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''/bin/zsh'\\''; export FOO='\\''bar'\\''; cd "/workspace" && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
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
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''/bin/zsh'\\''; cd "/workspace" && '\\''caffeinate'\\'' '\\''-i'\\'' '\\''direnv'\\'' '\\''exec'\\'' '\\''.'\\'' '\\''/opt/Claude Code/bin/claude'\\'' '\\''Fix the bug'\\'''`
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

    expect(result).toContain('tmux has-session -t \\"agent-session\\"');
    expect(result).toContain('tmux new-session -d -s \\"agent-session\\"');
    expect(result).toContain('tmux attach-session -t \\"agent-session\\"');
    expect(result).toContain('/bin/sh -c');
    expect(result).toContain("'\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\''");
  });

  it('launches remote general terminals with the captured remote shell', () => {
    const result = resolveSshCommand('general', makeGeneralConfig(), undefined, zshProfile);

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''/bin/zsh'\\''; cd "/workspace" && exec /bin/zsh -il'`
    );
  });

  it('uses the selected terminal shell for remote general terminals', () => {
    const result = resolveSshCommand(
      'general',
      makeGeneralConfig({ shell: 'bash' }),
      undefined,
      zshProfile
    );

    expect(result).toBe(
      `'/usr/bin/env' 'PATH=/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin' 'bash' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''bash'\\''; cd "/workspace" && exec bash -il'`
    );
  });

  it('uses task PATH overrides when looking up the selected remote shell', () => {
    const result = resolveSshCommand(
      'general',
      makeGeneralConfig({ shell: 'bash' }),
      { PATH: '/custom/bin:/usr/bin' },
      zshProfile
    );

    expect(result).toContain("'/usr/bin/env' 'PATH=/custom/bin:/usr/bin' 'bash'");
    expect(result).toContain("export PATH='\\''/custom/bin:/usr/bin'\\''");
    expect(result).toContain("export SHELL='\\''bash'\\''");
    expect(result).not.toContain("export SHELL='\\''/bin/zsh'\\''");
    expect(result).toContain('exec bash -il');
    expect(result).not.toContain('/bin/bash');
  });

  it('does not pass login flags to selected basic POSIX remote general shells', () => {
    const result = resolveSshCommand(
      'general',
      makeGeneralConfig({ shell: 'dash' }),
      undefined,
      zshProfile
    );

    expect(result).toBe(
      `'/usr/bin/env' 'PATH=/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin' 'dash' -c 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''dash'\\''; cd "/workspace" && exec dash -i'`
    );
  });

  it('does not pass login flags to selected csh remote general shells', () => {
    const result = resolveSshCommand(
      'general',
      makeGeneralConfig({ shell: 'tcsh' }),
      undefined,
      zshProfile
    );

    expect(result).toContain(
      "'/usr/bin/env' 'PATH=/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin' 'tcsh' -c"
    );
    expect(result).toContain('setenv PATH');
    expect(result).toContain('exec tcsh -i');
    expect(result).not.toContain('exec tcsh -il');
  });

  it('uses the selected terminal shell for remote agent command wrappers', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig({ shell: 'sh' }),
      undefined,
      zshProfile
    );

    expect(result).toBe(
      `'/usr/bin/env' 'PATH=/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin' 'sh' -c 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; export SHELL='\\''sh'\\''; cd "/workspace" && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
    );
  });
});
