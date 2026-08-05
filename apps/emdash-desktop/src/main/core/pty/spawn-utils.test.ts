import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RemoteShellProfile } from '@main/core/ssh/lifecycle/remote-shell-profile';
import type { ResolvedShellProfile } from '@main/core/terminal-shell/types';
import type { AgentSessionConfig } from '@shared/core/agents/agent-session';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import type { GeneralSessionConfig } from '@shared/core/terminals/general-session';
import { resolveSshCommand } from './spawn-utils';
import { makeTmuxSession } from './tmux-session-name';

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

const fishSystemProfile: ResolvedShellProfile = {
  id: 'target-default',
  resolvedShellId: 'fish',
  resolvedFromSystem: true,
  executable: '/usr/local/bin/fish',
  available: true,
  family: 'posix',
  interactiveArgs: ['-il'],
  commandArgs: ['-lc'],
  envCaptureArgs: ['-ilc'],
  capturedEnv: {
    PATH: '/usr/local/bin:/usr/bin',
  },
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
        tmuxSession: {
          name: 'agent-session',
          projectId: 'project-1',
          taskId: 'task-1',
          leafId: 'conv-1',
        },
      }),
      undefined,
      zshProfile
    );

    expect(result).toContain('preferred_name=$1');
    expect(result).toContain('find_matching_session');
    expect(result).toContain('list-sessions -F');
    expect(result).toContain('new-session -d -s "$session_name"');
    expect(result).toContain('attach-session -t "$session_name"');
    expect(result).toContain("'agent-session'");
    expect(result).toContain('/bin/sh');
    expect(result).toContain('claude');
    expect(result).toContain('--resume');
    expect(result).toContain('conv-1');
  });

  it('executes the generated SSH command and resumes an identity under its previous label', () => {
    const tempDir = mkdtempSync(path.join(tmpdir(), 'emdash-ssh-tmux-'));
    const tmuxStub = path.join(tempDir, 'tmux');
    const callsFile = path.join(tempDir, 'calls.log');
    try {
      writeFileSync(
        tmuxStub,
        `#!/bin/sh
printf '%s\\n' "$*" >> "$TMUX_CALLS"
if [ "$1" = "list-sessions" ]; then
  printf '%s\\t%s\\t%s\\t%s\\n' "$TMUX_EXISTING_NAME" "$TMUX_PROJECT" "$TMUX_TASK" "$TMUX_LEAF"
fi
exit 0
`
      );
      chmodSync(tmuxStub, 0o755);
      const sessionId = makePtySessionId('ssh-project', 'ssh-task', 'ssh-leaf');
      const oldSession = makeTmuxSession(sessionId, '/tmp/old-ssh-label');
      const currentSession = makeTmuxSession(sessionId, '/tmp/current-ssh-label');
      const remoteEnv = {
        PATH: `${tempDir}:/usr/bin:/bin`,
        TMPDIR: tempDir,
        TMUX_CALLS: callsFile,
        TMUX_EXISTING_NAME: oldSession.name,
        TMUX_PROJECT: oldSession.projectId,
        TMUX_TASK: oldSession.taskId,
        TMUX_LEAF: oldSession.leafId,
      };
      const command = resolveSshCommand(
        'agent',
        makeAgentConfig({ cwd: tempDir, tmuxSession: currentSession }),
        remoteEnv,
        { shell: '/bin/sh', env: {} }
      );

      execFileSync('/bin/sh', ['-c', command], { env: process.env });

      const calls = readFileSync(callsFile, 'utf8');
      expect(calls).toContain('list-sessions -F');
      expect(calls).not.toContain('new-session');
      expect(calls).toContain(`attach-session -t ${oldSession.name}`);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('launches remote general terminals with the captured remote shell', () => {
    const result = resolveSshCommand('general', makeGeneralConfig(), undefined, zshProfile);

    expect(result).toBe(
      `'/bin/zsh' -lc 'export PATH='\\''/Users/jona/.local/bin:/opt/homebrew/bin:/usr/bin'\\''; cd "/workspace" && exec /bin/zsh -il'`
    );
  });

  it('launches remote fish system terminals through a sh setup wrapper', () => {
    const result = resolveSshCommand('general', makeGeneralConfig(), undefined, fishSystemProfile);

    expect(result).toBe(
      `'/bin/sh' -c 'export PATH='\\''/usr/local/bin:/usr/bin'\\''; cd "/workspace" && exec /usr/local/bin/fish -il'`
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
