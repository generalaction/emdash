import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'junie',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'session-251209-172932-1ze8',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('Junie provider', () => {
  it('starts an interactive session with the documented prompt and model flags', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'Fix the test suite',
      model: 'gpt-codex',
    });

    expect(command).toEqual({
      command: 'junie',
      args: [
        '--session-id',
        'session-251209-172932-1ze8',
        '--model',
        'gpt-codex',
        '--prompt',
        'Fix the test suite',
      ],
      env: {},
    });
  });

  it('reopens the named native session with --session-id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'junie',
      args: ['--session-id', 'session-251209-172932-1ze8'],
      env: {},
    });
  });

  it('exposes documented model aliases and global JSON MCP configuration', () => {
    expect(provider.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: {
        sonnet: { name: 'Claude Sonnet' },
        'gpt-codex': { name: 'GPT Codex' },
        'gemini-pro': { name: 'Gemini Pro' },
      },
    });
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.behavior.mcp).toBeDefined();
  });
});
