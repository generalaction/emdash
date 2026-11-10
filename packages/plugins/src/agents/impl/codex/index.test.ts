import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'codex',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-session-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
};

describe('codex provider', () => {
  it.each([false, true])('isolates hook environments when resuming=%s', (isResuming) => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      isResuming,
      providerSessionId: isResuming ? 'native-session' : undefined,
    });
    expect(command.args).toEqual(
      isResuming ? ['--no-daemon', 'resume', 'native-session'] : ['--no-daemon']
    );
  });

  it('passes unquoted config overrides when auto-approve is enabled', () => {
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      autoApprove: true,
    });

    expect(command).toEqual({
      command: 'codex',
      args: [
        '--no-daemon',
        '-c',
        'approval_policy=never',
        '-c',
        'sandbox_mode=danger-full-access',
        '--dangerously-bypass-hook-trust',
      ],
      env: {},
    });
  });
});
