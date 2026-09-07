import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationStore } from '@core/features/conversations/api/browser/conversation-manager';
import { ConversationTabResource } from './conversation-tab-resource';

const registryGet = vi.hoisted(() => vi.fn());
const setTelemetryConversationScope = vi.hoisted(() => vi.fn());
const retryHydration = vi.hoisted(() => vi.fn());

vi.mock('@core/features/conversations/api/browser/stores/conversation-registry', () => ({
  conversationRegistry: { get: registryGet },
}));

vi.mock('@core/primitives/telemetry/browser/telemetry-scope', () => ({
  setTelemetryConversationScope,
}));

vi.mock('@core/features/conversations/browser/stores/conversation-session-manager', () => ({
  getConversationSessionManager: () => ({ retryHydration }),
}));

describe('ConversationTabResource activation', () => {
  const isSessionActive = vi.fn();

  beforeEach(() => {
    registryGet.mockReset();
    setTelemetryConversationScope.mockReset();
    retryHydration.mockReset();
    isSessionActive.mockReset();
    registryGet.mockReturnValue({
      conversations: new Map([['conversation-1', {}]]),
      isSessionActive,
    });
  });

  it('rehydrates an inactive TUI conversation when its tab is selected', () => {
    isSessionActive.mockReturnValue(false);
    const resource = new ConversationTabResource(tuiStore(), 'task-1', tabHandle());

    resource.onActivate();

    expect(retryHydration).toHaveBeenCalledWith('conversation-1');
    resource.dispose();
  });

  it('checks the host even when a stale observation still says the session is active', () => {
    isSessionActive.mockReturnValue(true);
    const resource = new ConversationTabResource(tuiStore(), 'task-1', tabHandle());

    resource.onActivate();

    expect(retryHydration).toHaveBeenCalledWith('conversation-1');
    resource.dispose();
  });

  it('leaves ACP conversation recovery to the ACP store', () => {
    isSessionActive.mockReturnValue(false);
    const resource = new ConversationTabResource(acpStore(), 'task-1', tabHandle());

    resource.onActivate();

    expect(retryHydration).not.toHaveBeenCalled();
    resource.dispose();
  });
});

function tuiStore(): ConversationStore {
  return {
    data: { id: 'conversation-1', type: 'pty' },
    seen: true,
    markSeen: vi.fn(),
  } as unknown as ConversationStore;
}

function acpStore(): ConversationStore {
  return {
    data: { id: 'conversation-1', type: 'acp' },
    seen: true,
    markSeen: vi.fn(),
  } as unknown as ConversationStore;
}

function tabHandle() {
  return { close: vi.fn() } as never;
}
