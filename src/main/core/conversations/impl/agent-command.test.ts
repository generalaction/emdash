import { describe, expect, it, vi } from 'vitest';
import { providerConfigDefaults } from '@main/core/settings/schema';
import { buildAgentCommand } from './agent-command';

vi.mock('@main/core/settings/provider-settings-service', () => ({
  providerOverrideSettings: {
    getItem: vi.fn(async (providerId: string) => providerConfigDefaults[providerId]),
  },
}));

describe('buildAgentCommand', () => {
  it('uses the current Codex bypass flag when auto-approve is enabled', async () => {
    const command = await buildAgentCommand({
      providerId: 'codex',
      autoApprove: true,
      initialPrompt: 'Fix the issue',
      sessionId: 'session-1',
    });

    expect(command).toEqual({
      command: 'codex',
      args: ['--dangerously-bypass-approvals-and-sandbox', 'Fix the issue'],
    });
  });
});
