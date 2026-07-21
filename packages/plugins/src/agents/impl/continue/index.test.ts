import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'cn',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('Continue provider', () => {
  it('uses Continue headless flags for a prompt, model, and all-tools approval', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'Fix the test suite',
      model: 'anthropic/claude-4-sonnet',
    });

    expect(command).toEqual({
      command: 'cn',
      args: ['--auto', '--model', 'anthropic/claude-4-sonnet', '--prompt', 'Fix the test suite'],
      env: {},
    });
  });

  it('resumes the provider-selected most recent session without passing an Emdash UUID', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({ command: 'cn', args: ['--resume'], env: {} });
  });

  it('writes supported MCP transports to Continue global configuration', () => {
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.behavior.mcp).toBeDefined();
  });
});
