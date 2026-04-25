import { describe, expect, it } from 'vitest';
import type { AgentSessionConfig } from '@shared/agent-session';
import type { GeneralSessionConfig } from '@shared/general-session';
import { buildTmuxParams, resolveSpawnParams, resolveSshCommand } from './spawn-utils';

const SHELL = '/bin/bash';

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
    cwd: '/workspace',
    ...overrides,
  };
}

describe('resolveSpawnParams – agent type', () => {
  it('no tmux, no shellSetup → shell -c with command joined', () => {
    const config = makeAgentConfig();
    const result = resolveSpawnParams('agent', config);

    expect(result.cwd).toBe('/workspace');
    expect(result.command).toBe(process.env.SHELL ?? '/bin/sh');
    expect(result.args[0]).toBe('-c');
    expect(result.args[1]).toBe('claude --resume conv-1');
  });

  it('with shellSetup → shellSetup prepended with &&', () => {
    const config = makeAgentConfig({ shellSetup: 'source ~/.nvm/nvm.sh' });
    const result = resolveSpawnParams('agent', config);

    expect(result.args[0]).toBe('-c');
    expect(result.args[1]).toBe('source ~/.nvm/nvm.sh && claude --resume conv-1');
  });

  it('with tmuxSessionName → tmux command contains has-session and session name', () => {
    const config = makeAgentConfig({ tmuxSessionName: 'my-session' });
    const result = resolveSpawnParams('agent', config);

    expect(result.args[0]).toBe('-c');
    const cmd = result.args[1];
    expect(cmd).toContain('tmux has-session');
    expect(cmd).toContain('"my-session"');
    expect(cmd).toContain('tmux attach-session');
  });

  it('with both shellSetup and tmuxSessionName → tmux command contains shellSetup', () => {
    const config = makeAgentConfig({
      shellSetup: 'export NVM_DIR="$HOME/.nvm"',
      tmuxSessionName: 'agent-session',
    });
    const result = resolveSpawnParams('agent', config);

    expect(result.args[0]).toBe('-c');
    const cmd = result.args[1];
    expect(cmd).toContain('tmux has-session');
    expect(cmd).toContain('"agent-session"');
    expect(cmd).toContain('export NVM_DIR=\\"$HOME/.nvm\\"');
    expect(cmd).toContain('claude --resume conv-1');
  });
});

describe('resolveSpawnParams – general type', () => {
  it('no command, no shellSetup → shell -c exec shell -il', () => {
    const config = makeGeneralConfig();
    const result = resolveSpawnParams('general', config);

    const shell = process.env.SHELL ?? '/bin/sh';
    expect(result.command).toBe(shell);
    expect(result.args[0]).toBe('-il');
    expect(result.cwd).toBe('/workspace');
  });

  it('with shellSetup → shell -c with shellSetup && exec shell -il', () => {
    const config = makeGeneralConfig({ shellSetup: 'source /opt/homebrew/bin/brew shellenv' });
    const result = resolveSpawnParams('general', config);

    expect(result.args[0]).toBe('-c');
    const cmd = result.args[1];
    expect(cmd).toContain('source /opt/homebrew/bin/brew shellenv');
    expect(cmd).toContain('exec');
    expect(cmd).toContain('-il');
  });

  it('with tmuxSessionName → tmux wrapping', () => {
    const config = makeGeneralConfig({ tmuxSessionName: 'general-session' });
    const result = resolveSpawnParams('general', config);

    expect(result.args[0]).toBe('-c');
    const cmd = result.args[1];
    expect(cmd).toContain('tmux has-session');
    expect(cmd).toContain('"general-session"');
    expect(cmd).toContain('tmux attach-session');
  });

  it('with both shellSetup and tmuxSessionName → tmux command contains shellSetup', () => {
    const config = makeGeneralConfig({
      shellSetup: 'eval "$(rbenv init -)"',
      tmuxSessionName: 'ruby-session',
    });
    const result = resolveSpawnParams('general', config);

    expect(result.args[0]).toBe('-c');
    const cmd = result.args[1];
    expect(cmd).toContain('tmux has-session');
    expect(cmd).toContain('"ruby-session"');
    expect(cmd).toContain('rbenv init');
  });

  it('with command → shell -c with the command instead of interactive shell', () => {
    const config = makeGeneralConfig({ command: 'npm', args: ['install'] });
    const result = resolveSpawnParams('general', config);

    expect(result.args[0]).toBe('-c');
    expect(result.args[1]).toBe('npm install');
  });

  it('with command and shellSetup → shellSetup prepended to command', () => {
    const config = makeGeneralConfig({ command: 'npm', args: ['install'], shellSetup: 'nvm use' });
    const result = resolveSpawnParams('general', config);

    expect(result.args[0]).toBe('-c');
    expect(result.args[1]).toBe('nvm use && npm install');
  });

  it('with command and tmuxSessionName → tmux wrapping around the command', () => {
    const config = makeGeneralConfig({
      command: 'npm',
      args: ['install'],
      tmuxSessionName: 'setup-session',
    });
    const result = resolveSpawnParams('general', config);

    expect(result.args[0]).toBe('-c');
    const cmd = result.args[1];
    expect(cmd).toContain('tmux has-session');
    expect(cmd).toContain('"setup-session"');
    expect(cmd).toContain('npm install');
  });
});

describe('buildTmuxParams', () => {
  it('produces attach-or-create command with has-session, new-session -d, and attach-session', () => {
    const result = buildTmuxParams(SHELL, 'my-tmux-session', 'claude --resume conv-42', '/tmp');

    expect(result.command).toBe(SHELL);
    expect(result.cwd).toBe('/tmp');
    expect(result.args[0]).toBe('-c');

    const cmd = result.args[1];
    expect(cmd).toContain('tmux has-session -t "my-tmux-session"');
    expect(cmd).toContain('tmux new-session -d -s "my-tmux-session"');
    expect(cmd).toContain('tmux attach-session -t "my-tmux-session"');
    const attachCount = (cmd.match(/tmux attach-session/g) ?? []).length;
    expect(attachCount).toBe(2);
  });

  it('JSON-encodes the session name and command', () => {
    const result = buildTmuxParams(SHELL, 'session with spaces', 'echo hello', '/home/user');

    const cmd = result.args[1];
    expect(cmd).toContain('"session with spaces"');
    expect(cmd).toContain('"echo hello"');
  });

  it('uses the provided cwd', () => {
    const result = buildTmuxParams(SHELL, 'sess', 'cmd', '/custom/path');
    expect(result.cwd).toBe('/custom/path');
  });
});

describe('resolveSshCommand', () => {
  it('runs remote commands through a login shell so PATH matches install/probe', () => {
    const result = resolveSshCommand('agent', makeAgentConfig());

    expect(result).toBe(`bash -l -c 'cd "/workspace" && claude --resume conv-1'`);
  });
});
