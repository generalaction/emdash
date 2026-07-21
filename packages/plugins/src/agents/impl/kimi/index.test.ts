import type { CommandContext } from '@emdash/core/agents/plugins';
import { describe, expect, it } from 'vitest';
import { provider } from './index';

const baseContext = {
  cli: 'kimi',
  autoApprove: false,
  initialPrompt: undefined,
  sessionId: 'emdash-conversation-id',
  providerSessionId: undefined,
  isResuming: false,
  model: '',
} satisfies CommandContext;

describe('kimi provider', () => {
  it('injects hooks into inline config by default', () => {
    const inlineConfig = JSON.stringify({ theme: 'dark' });
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      extraArgs: [`--config=${inlineConfig}`],
    });

    expect(command.args.join(' ')).toContain('EMDASH_HOOK_PORT');
  });

  it('preserves inline config when hook injection is disabled', () => {
    const inlineConfig = JSON.stringify({ theme: 'dark' });
    const command = provider.behavior.prompt!.buildCommand({
      ...baseContext,
      extraArgs: [`--config=${inlineConfig}`],
      injectAgentNotificationHooks: false,
    });

    expect(command.args).toContain(`--config=${inlineConfig}`);
    expect(command.args.join(' ')).not.toContain('EMDASH_HOOK_PORT');
  });
});
