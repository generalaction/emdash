import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'qwen',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('qwen provider', () => {
  it('uses approval-mode=yolo for auto-approve', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
    });

    expect(command).toEqual({
      command: 'qwen',
      args: ['--approval-mode=yolo'],
      env: {},
    });
  });

  it('resumes the latest project session without passing the emdash session id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'qwen',
      args: ['--continue'],
      env: {},
    });
  });
});
