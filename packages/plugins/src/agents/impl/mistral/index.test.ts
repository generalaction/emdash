import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'vibe',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('Mistral Vibe provider', () => {
  it('advertises Vibe native MCP and resumable-session support', () => {
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.capabilities.sessions).toEqual({ kind: 'resumable' });
  });

  it('uses Vibe programmatic flags instead of passing the prompt positionally', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      model: 'mistral-medium-3.5',
    });

    expect(command).toEqual({
      command: 'vibe',
      args: ['--auto-approve', '--prompt', 'Fix the bug'],
      env: { VIBE_ACTIVE_MODEL: 'mistral-medium-3.5' },
    });
  });

  it('resumes a stored Vibe session id with --resume', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      providerSessionId: 'abc123',
      isResuming: true,
    });

    expect(command).toEqual({ command: 'vibe', args: ['--resume', 'abc123'], env: {} });
  });

  it('continues the latest Vibe session when no native session id is stored', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({ command: 'vibe', args: ['--continue'], env: {} });
  });
});
