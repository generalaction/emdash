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
  it('does not advertise auto-approve because Crush rejects --yolo with run', () => {
    expect(provider.capabilities.autoApprove).toEqual({ kind: 'none' });
  });

  it('supports Crush MCP configuration through the transports Emdash can represent', () => {
    expect(provider.capabilities.mcp).toEqual({
      kind: 'supported',
      scope: 'global',
      supportedTransports: ['stdio', 'http'],
    });
    expect(provider.behavior.mcp).toBeDefined();
  });

  it('runs a fresh prompt through crush run with the prompt as a positional arg', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'implement the task',
    });

    expect(command).toEqual({
      command: 'crush',
      args: ['run', 'implement the task'],
      env: {},
    });
  });

  it('passes a selected model to Crush run with the documented --model flag', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'implement the task',
      model: 'openai/gpt-5.4',
    });

    expect(command).toEqual({
      command: 'crush',
      args: ['run', '--model', 'openai/gpt-5.4', 'implement the task'],
      env: {},
    });
  });

  it('starts an empty fresh session in interactive mode', () => {
    const command = provider.behavior.prompt!.buildCommand(baseContext);

    expect(command).toEqual({
      command: 'crush',
      args: [],
      env: {},
    });
  });

  it('continues the most recent Crush session when no native session id is stored', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
    });

    expect(command).toEqual({
      command: 'crush',
      args: ['--continue'],
      env: {},
    });
  });

  it('resumes a stored native Crush session with --session', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming: true,
      providerSessionId: 'b78e4cf1-27ee-4ef5-a58c-d7480a7c9a22',
    });

    expect(command).toEqual({
      command: 'crush',
      args: ['--session', 'b78e4cf1-27ee-4ef5-a58c-d7480a7c9a22'],
      env: {},
    });
  });
});
