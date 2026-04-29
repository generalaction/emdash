import { beforeEach, describe, expect, it, vi } from 'vitest';
import { providerOverrideSettings } from '@main/core/settings/provider-settings-service';
import { buildAgentCommand, splitShellWords } from './agent-command';

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItem: vi.fn(),
  },
}));

const getItem = vi.mocked(providerOverrideSettings.getItem);

describe('splitShellWords', () => {
  it('handles empty input and quoting', () => {
    expect(splitShellWords('')).toEqual([]);
    expect(splitShellWords('--foo=\'a b\'"c d"')).toEqual(['--foo=a bc d']);
    expect(splitShellWords('--x "a b"')).toEqual(['--x', 'a b']);
    expect(splitShellWords(`--x "that's ok"`)).toEqual(['--x', "that's ok"]);
    expect(splitShellWords(`--x 'say "hi"'`)).toEqual(['--x', 'say "hi"']);
  });

  it('preserves non-special backslashes inside double quotes', () => {
    expect(splitShellWords('--x "foo\\nbar"')).toEqual(['--x', 'foo\\nbar']);
    expect(splitShellWords('--x "foo\\$bar"')).toEqual(['--x', 'foo$bar']);
    expect(splitShellWords('--x foo\\')).toEqual(['--x', 'foo\\']);
  });
});

describe('buildAgentCommand', () => {
  beforeEach(() => {
    getItem.mockReset();
  });

  it('parses cli command lines and puts extra args before a positional prompt', async () => {
    getItem.mockResolvedValue({
      cli: 'claude --model sonnet',
      extraArgs: '--verbose',
      autoApproveFlag: '--dangerously-skip-permissions',
      sessionIdFlag: '--session-id',
      initialPromptFlag: '',
    });

    await expect(
      buildAgentCommand({
        providerId: 'claude',
        autoApprove: true,
        sessionId: 'session-1',
        initialPrompt: 'hello',
      })
    ).resolves.toEqual({
      command: 'claude',
      args: [
        '--model',
        'sonnet',
        '--session-id',
        'session-1',
        '--dangerously-skip-permissions',
        '--verbose',
        'hello',
      ],
    });
  });

  it('keeps custom Claude command names generic when they do not resolve to the system compiler', async () => {
    getItem.mockResolvedValue({
      cli: 'c --already-configured',
      autoApproveFlag: '--dangerously-skip-permissions',
      sessionIdFlag: '--session-id',
      initialPromptFlag: '',
    });
    const exec = vi.fn().mockRejectedValue(new Error('not found'));

    await expect(
      buildAgentCommand({
        providerId: 'claude',
        autoApprove: true,
        sessionId: 'session-1',
        exec,
      })
    ).resolves.toEqual({
      command: 'c',
      args: ['--already-configured', '--session-id', 'session-1', '--dangerously-skip-permissions'],
    });
  });

  it('falls back to claude when a custom Claude command resolves to the system C compiler', async () => {
    getItem.mockResolvedValue({
      cli: 'cc',
      autoApproveFlag: '--dangerously-skip-permissions',
      sessionIdFlag: '--session-id',
      initialPromptFlag: '',
    });
    const exec = vi.fn().mockResolvedValue({ stdout: '/usr/bin/cc\n', stderr: '' });

    await expect(
      buildAgentCommand({
        providerId: 'claude',
        autoApprove: true,
        sessionId: 'session-1',
        exec,
      })
    ).resolves.toEqual({
      command: 'claude',
      args: ['--session-id', 'session-1', '--dangerously-skip-permissions'],
    });
  });

  it('falls back to the registry cli when the custom cli is blank', async () => {
    getItem.mockResolvedValue({
      cli: ' ',
      autoApproveFlag: '--dangerously-skip-permissions',
      sessionIdFlag: '--session-id',
      initialPromptFlag: '',
    });

    await expect(
      buildAgentCommand({
        providerId: 'claude',
        sessionId: 'session-1',
      })
    ).resolves.toEqual({ command: 'claude', args: ['--session-id', 'session-1'] });
  });

  it('tokenizes resume flags consistently with cli args', async () => {
    getItem.mockResolvedValue({
      cli: 'claude --model sonnet',
      resumeFlag: '--resume "last session"',
      sessionIdFlag: '--session-id',
      initialPromptFlag: '',
    });

    await expect(
      buildAgentCommand({
        providerId: 'claude',
        isResuming: true,
        sessionId: 'session-1',
      })
    ).resolves.toEqual({
      command: 'claude',
      args: ['--model', 'sonnet', '--resume', 'last session', 'session-1'],
    });
  });
});
