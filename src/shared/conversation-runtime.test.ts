import { describe, expect, it } from 'vitest';
import type { AgentProviderDefinition } from './agent-provider-registry';
import { providerSupportsAcpRuntime, resolveConversationRuntime } from './conversation-runtime';

const provider = {
  id: 'codex',
  name: 'Codex',
  supportsAcp: true,
  acpCommand: ['codex', 'acp'],
} satisfies AgentProviderDefinition;

describe('conversation-runtime', () => {
  it('keeps terminal as the default runtime', () => {
    expect(resolveConversationRuntime({ provider })).toBe('terminal');
  });

  it('allows ACP only when provider metadata advertises a real ACP command', () => {
    expect(
      resolveConversationRuntime({
        provider,
        providerConfig: { defaultConversationRuntime: 'acp' },
      })
    ).toBe('acp');
    expect(
      resolveConversationRuntime({
        provider: { ...provider, acpCommand: undefined },
        providerConfig: { defaultConversationRuntime: 'acp' },
      })
    ).toBe('terminal');
  });

  it('allows ACP for supported providers with a configured ACP command override', () => {
    expect(
      resolveConversationRuntime({
        provider: { ...provider, acpCommand: undefined },
        providerConfig: { defaultConversationRuntime: 'acp', acpCommand: ['custom-acp'] },
      })
    ).toBe('acp');
  });

  it('lets an explicit per-conversation terminal request override a provider ACP default', () => {
    expect(
      resolveConversationRuntime({
        provider,
        providerConfig: { defaultConversationRuntime: 'acp' },
        requestedRuntime: 'terminal',
      })
    ).toBe('terminal');
  });

  it('treats ACP support as false without both support metadata and command metadata', () => {
    expect(providerSupportsAcpRuntime(provider)).toBe(true);
    expect(providerSupportsAcpRuntime({ ...provider, supportsAcp: false })).toBe(false);
    expect(providerSupportsAcpRuntime({ ...provider, acpCommand: [] })).toBe(false);
  });
});
