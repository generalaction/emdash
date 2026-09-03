import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'muse',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('muse provider', () => {
  it('declares positional argv prompt delivery and stateless sessions', () => {
    expect(provider.capabilities.prompt).toEqual({ kind: 'argv', flag: '' });
    expect(provider.capabilities.sessions).toEqual({ kind: 'stateless' });
    expect(provider.capabilities.autoApprove).toEqual({ kind: 'supported' });
  });

  it('probes the muse binary with the Meta install script', () => {
    expect(provider.capabilities.hostDependency).toMatchObject({
      id: 'muse',
      binaryNames: ['muse'],
    });
    const commands = provider.capabilities.hostDependency.installCommands!;
    for (const platform of ['macos', 'linux'] as const) {
      expect(commands[platform]![0].command).toContain('https://dev.meta.ai/install.sh');
    }
  });

  it('passes a fresh prompt positionally with --yolo when auto-approved', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
      initialPrompt: 'implement the task',
    });

    expect(command).toEqual({
      command: 'muse',
      args: ['--yolo', 'implement the task'],
      env: {},
    });
  });

  it('omits --yolo without auto-approve', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      initialPrompt: 'implement the task',
    });

    expect(command).toEqual({
      command: 'muse',
      args: ['implement the task'],
      env: {},
    });
  });

  it('starts an empty fresh session in interactive mode', () => {
    const command = provider.behavior.prompt!.buildCommand(baseContext);

    expect(command).toEqual({
      command: 'muse',
      args: [],
      env: {},
    });
  });
});
