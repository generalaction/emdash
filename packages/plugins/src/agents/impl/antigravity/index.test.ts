import type { CommandContext } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext: CommandContext = {
  cli: 'agy',
  autoApprove: false,
  sessionId: 'emdash-conversation-id',
  isResuming: false,
  model: '',
};

describe('antigravity provider', () => {
  it('starts fresh with the initial prompt without passing the emdash conversation id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'Fix the bug',
    });

    expect(command).toEqual({
      command: 'agy',
      args: ['-i', 'Fix the bug'],
      env: {},
    });
  });

  it('resumes the captured native conversation id without replaying the initial prompt', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      providerSessionId: 'native-conversation-id',
      isResuming: true,
      initialPrompt: 'Do not replay this',
    });

    expect(command.args).toEqual(['--conversation=native-conversation-id']);
  });

  it('uses the continue fallback when asked to resume without a native conversation id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
      initialPrompt: 'Do not replay this',
    });

    expect(command.args).toEqual(['-c']);
  });
});
