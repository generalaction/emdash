import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'agy',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('antigravity provider', () => {
  it('starts a fresh prompted session with -p (not -i, which requires a TTY)', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'say hello',
    });

    expect(command).toEqual({
      command: 'agy',
      args: ['--conversation=emdash-session-id', '-p', 'say hello'],
      env: {},
    });
  });

  it('injects --dangerously-skip-permissions for auto-approve', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'say hello',
    });

    expect(command.args).toContain('--dangerously-skip-permissions');
  });

  it('injects --conversation= on resume as well as fresh sessions', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'agy',
      args: ['--conversation=emdash-session-id'],
      env: {},
    });
  });

  it('injects --model when ctx.model is set', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      model: 'Gemini 3.1 Pro (High)',
    });

    expect(command.args).toContain('--model');
    const modelIdx = command.args.indexOf('--model');
    expect(command.args[modelIdx + 1]).toBe('Gemini 3.1 Pro (High)');
  });
});
