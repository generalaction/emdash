import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'cursor-agent',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('Cursor provider', () => {
  it('advertises Cursor CLI model, MCP, and resumable-session support', () => {
    expect(provider.capabilities.models).toMatchObject({
      kind: 'selectable',
      modelOptions: { 'gpt-5': { name: 'GPT-5' } },
    });
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.capabilities.sessions).toEqual({ kind: 'resumable' });
  });

  it('auto-approves commands and MCP servers for a new Cursor session', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      model: 'gpt-5',
    });

    expect(command).toEqual({
      command: 'cursor-agent',
      args: ['--force', '--approve-mcps', '--model', 'gpt-5', 'Fix the bug'],
      env: {},
    });
  });

  it('resumes a stored Cursor chat with its native id', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      providerSessionId: 'cursor-chat-id',
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'cursor-agent',
      args: ['--resume', 'cursor-chat-id'],
      env: {},
    });
  });

  it('uses Cursor resume when the native chat id is not yet known', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({ command: 'cursor-agent', args: ['resume'], env: {} });
  });
});
