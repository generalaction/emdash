import { describe, expect, it } from 'vitest';
import { provider } from './index';

describe('Muse Code provider', () => {
  it('uses the official installer on supported platforms', () => {
    const dependency = provider.capabilities.hostDependency;

    expect(dependency.binaryNames).toEqual(['muse']);
    expect(dependency.installCommands.macos?.[0]).toMatchObject({
      method: 'curl',
      command: 'curl -fsSL https://dev.meta.ai/install.sh | bash',
      recommended: true,
    });
    expect(dependency.installCommands.linux).toEqual(dependency.installCommands.macos);
    expect(dependency.installCommands.windows).toBeUndefined();
  });

  it('starts the interactive TUI and enables unattended mode when requested', () => {
    const result = provider.behavior.prompt!.buildCommand({
      cli: 'muse',
      autoApprove: true,
      initialPrompt: 'Fix the bug',
      sessionId: 'conversation-1',
      isResuming: false,
      model: '',
    });

    expect(result).toEqual({
      command: 'muse',
      args: ['--yolo'],
      env: {},
    });
  });
});
