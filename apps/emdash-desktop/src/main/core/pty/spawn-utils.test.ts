import { describe, expect, it } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import type { AgentSessionConfig } from '@shared/core/agents/agent-session';
import type { GeneralSessionConfig } from '@shared/core/terminals/general-session';
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

const tcshLoginProfile: RemoteShellProfile = {
  shell: '/bin/tcsh',
  env: {
    PATH: '/usr/bin',
  },
};

const bashRemoteProfile: ResolvedShellProfile = {
  id: 'bash',
  resolvedShellId: 'bash',
  resolvedFromSystem: false,
  executable: 'bash',
  available: true,
  family: 'posix',
  interactiveArgs: ['-il'],
  commandArgs: ['-lc'],
  envCaptureArgs: ['-ilc'],
  capturedEnv: {
    PATH: '/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin',
  },
  remotePathLookup: true,
};

const tcshRemoteProfile: ResolvedShellProfile = {
  id: 'tcsh',
  resolvedShellId: 'tcsh',
  resolvedFromSystem: false,
  executable: 'tcsh',
  available: true,
  family: 'csh',
  interactiveArgs: ['-i'],
  commandArgs: ['-c'],
  envCaptureArgs: ['-i', '-c'],
  capturedEnv: {
    PATH: '/usr/bin',
  },
  remotePathLookup: true,
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

  it('keeps captured csh-family login shells on the supported sh fallback for agents', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig({
        shellSetup: 'export FOO=bar',
      }),
      undefined,
      tcshLoginProfile
    );

    expect(result).toBe(
      `'/bin/sh' -c 'export PATH='\\''/usr/bin'\\''; cd "/workspace" && export FOO=bar && '\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\'''`
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

    expect(result).toContain('tmux has-session -t \\"agent-session\\"');
    expect(result).toContain('tmux -u new-session -d -s \\"agent-session\\"');
    expect(result).toContain('tmux -u attach-session -t \\"agent-session\\"');
    expect(result).toContain('/bin/sh -c');
    expect(result).toContain("'\\''claude'\\'' '\\''--resume'\\'' '\\''conv-1'\\''");
  });

  it('launches remote general terminals with the captured remote shell', () => {
    const result = resolveSshCommand('general', makeGeneralConfig(), undefined, zshProfile);

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd "/workspace" && exec /bin/zsh -il'`
    );
  });

  it('uses the selected remote shell profile with PATH lookup for general terminals', () => {
    const result = resolveSshCommand('general', makeGeneralConfig(), undefined, bashRemoteProfile);

    expect(result).toContain(
      `'/usr/bin/env' 'PATH=/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin' 'bash' -lc`
    );
    expect(result).toContain(
      `export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''`
    );
    expect(result).toContain(`export SHELL='\\''bash'\\''`);
    expect(result).toContain(`cd "/workspace" && exec bash -il`);
  });

  it('uses task PATH overrides when looking up the selected remote shell', () => {
    const result = resolveSshCommand(
      'general',
      makeGeneralConfig(),
      { PATH: '/task/bin:/usr/bin' },
      bashRemoteProfile
    );

    expect(result).toContain(`'/usr/bin/env' 'PATH=/task/bin:/usr/bin' 'bash' -lc`);
    expect(result.indexOf('/Users/jona/.local/bin')).toBeLessThan(
      result.lastIndexOf('/task/bin:/usr/bin')
    );
    expect(result).toContain(`export SHELL='\\''bash'\\''`);
  });

  it('escapes history expansion for csh-family remote argv commands', () => {
    const result = resolveSshCommand(
      'agent',
      makeAgentConfig({
        command: 'printf',
        args: ['hello!'],
      }),
      undefined,
      tcshRemoteProfile
    );

    expect(result).toContain("'/usr/bin/env' 'PATH=/usr/bin' 'tcsh' -c");
    expect(result).toContain("'\\''hello\\!'\\''");
  });
});
