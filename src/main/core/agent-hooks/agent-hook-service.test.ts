import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentEvent } from '@shared/events/agentEvents';
import { agentHookService } from './agent-hook-service';
import type { RawHookRequest } from './hook-server';

const mocks = vi.hoisted(() => ({
  emit: vi.fn(),
  enrichEvent: vi.fn(),
  handler: undefined as ((raw: RawHookRequest) => Promise<void>) | undefined,
  isAppFocused: vi.fn(),
  maybeShowNotification: vi.fn(),
}));

vi.mock('./hook-server', () => ({
  HookServer: class {
    async start(handler: (raw: RawHookRequest) => Promise<void>): Promise<void> {
      mocks.handler = handler;
    }

    stop(): void {}

    getPort(): number {
      return 12345;
    }

    getToken(): string {
      return 'token';
    }
  },
}));

vi.mock('./event-enricher', () => ({
  enrichEvent: mocks.enrichEvent,
}));

vi.mock('./codex-session-start', () => ({
  handleCodexSessionStartHook: vi.fn(),
}));

vi.mock('./handle-provider-session-hook', () => ({
  handleProviderSessionHook: vi.fn(),
}));

vi.mock('./notification', () => ({
  isAppFocused: mocks.isAppFocused,
  maybeShowNotification: mocks.maybeShowNotification,
}));

vi.mock('@main/core/conversations/conversation-events', () => ({
  conversationEvents: {
    on: vi.fn(),
  },
}));

vi.mock('@main/core/conversations/touchConversation', () => ({
  touchConversation: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: {
    emit: mocks.emit,
  },
}));

vi.mock('@main/lib/logger', () => ({
  log: {
    warn: vi.fn(),
  },
}));

vi.mock('@main/lib/telemetry', () => ({
  telemetryService: {
    capture: vi.fn(),
  },
}));

function makeAgentEvent(): AgentEvent {
  return {
    type: 'notification',
    source: 'hook',
    providerId: 'codex',
    projectId: 'project-1',
    taskId: 'task-1',
    conversationId: 'conversation-1',
    timestamp: 1,
    payload: {
      lastAssistantMessage: 'done',
    },
  };
}

describe('AgentHookService', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mocks.handler = undefined;
    mocks.isAppFocused.mockReturnValue(false);
    mocks.enrichEvent.mockResolvedValue(makeAgentEvent());
    mocks.maybeShowNotification.mockResolvedValue(undefined);
    await agentHookService.initialize();
  });

  it('emits enriched hook events and notifications without writing to chat runtime', async () => {
    const event = makeAgentEvent();
    mocks.enrichEvent.mockResolvedValue(event);

    await mocks.handler?.({ ptyId: 'codex:conversation-1', type: 'notification', body: '{}' });

    expect(mocks.maybeShowNotification).toHaveBeenCalledWith(event, false);
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'agent:event' }), {
      event,
      appFocused: false,
    });
  });

  it('emits agent events after notification handling', async () => {
    const event = makeAgentEvent();
    mocks.enrichEvent.mockResolvedValue(event);

    await mocks.handler?.({ ptyId: 'codex:conversation-1', type: 'notification', body: '{}' });

    expect(mocks.maybeShowNotification).toHaveBeenCalledWith(event, false);
    expect(mocks.emit).toHaveBeenCalledWith(expect.objectContaining({ name: 'agent:event' }), {
      event,
      appFocused: false,
    });
  });
});
