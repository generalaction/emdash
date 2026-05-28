import { describe, expect, it } from 'vitest';
import {
  resolveConversationRuntimeMode,
  shouldUseChatRuntime,
  supportsChatRuntime,
} from './conversations';

describe('resolveConversationRuntimeMode', () => {
  it('uses chat when requested for a provider with an implemented chat runtime', () => {
    expect(
      resolveConversationRuntimeMode({
        providerId: 'codex',
        requestedMode: 'chat',
      })
    ).toBe('chat');
  });

  it('falls back to terminal when chat is requested for a terminal-only provider', () => {
    expect(
      resolveConversationRuntimeMode({
        providerId: 'grok',
        requestedMode: 'chat',
      })
    ).toBe('terminal');
  });

  it('falls back to terminal for Paseo-supported providers before an Emdash runtime exists', () => {
    expect(
      resolveConversationRuntimeMode({
        providerId: 'claude',
        requestedMode: 'chat',
      })
    ).toBe('terminal');
  });

  it('keeps terminal mode when terminal is requested for a chat-capable provider', () => {
    expect(
      resolveConversationRuntimeMode({
        providerId: 'codex',
        requestedMode: 'terminal',
      })
    ).toBe('terminal');
  });
});

describe('supportsChatRuntime', () => {
  it('requires an Emdash runtime adapter, not only provider UI capability', () => {
    expect(supportsChatRuntime('codex')).toBe(true);
    expect(supportsChatRuntime('claude')).toBe(false);
  });
});

describe('shouldUseChatRuntime', () => {
  it('uses chat rows only when an adapter is available', () => {
    expect(shouldUseChatRuntime({ providerId: 'codex', runtimeMode: 'chat' })).toBe(true);
    expect(shouldUseChatRuntime({ providerId: 'claude', runtimeMode: 'chat' })).toBe(false);
  });
});
