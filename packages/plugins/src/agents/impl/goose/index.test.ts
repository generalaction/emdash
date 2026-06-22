import { describe, expect, it } from 'vitest';
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

describe('goose provider', () => {
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

  it('resumes the named run with --resume as a boolean flag', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'goose',
      args: ['run', '-s', '-n', 'emdash-conversation-id', '--resume'],
      env: {},
    });
  });

  it('does not add an auto-approve flag because Goose has no supported CLI mode for it', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'Fix the bug',
    });

    expect(command.args).toEqual([
      'run',
      '-s',
      '-n',
      'emdash-conversation-id',
      '-t',
      'Fix the bug',
    ]);
  });
});
