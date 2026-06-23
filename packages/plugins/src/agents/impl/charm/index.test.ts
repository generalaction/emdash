import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'crush',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('charm provider', () => {
  it('runs a fresh prompt through crush run with the prompt as a positional arg', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'implement the task',
    });

    expect(command).toEqual({
      command: 'crush',
      args: ['run', '--session', 'emdash-session-id', 'implement the task'],
      env: {},
    });
  });

  it('resumes the same named crush session', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'crush',
      args: ['run', '--session', 'emdash-session-id'],
      env: {},
    });
  });

  it('keeps yolo after the session selector', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'implement the task',
    });

    expect(command.args).toEqual([
      'run',
      '--session',
      'emdash-session-id',
      '--yolo',
      'implement the task',
    ]);
  });
});
