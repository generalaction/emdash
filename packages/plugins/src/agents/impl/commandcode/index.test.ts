import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'cmd',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('commandcode provider', () => {
  it('continues the last session when resuming without a stored provider session id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'cmd',
      args: ['--trust', '--skip-onboarding', '-c'],
      env: {},
    });
  });

  it('resumes a stored provider session id with --resume', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      providerSessionId: 'command-session-id',
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'cmd',
      args: ['--trust', '--skip-onboarding', '--resume', 'command-session-id'],
      env: {},
    });
  });
});
