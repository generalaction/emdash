import { beforeEach, describe, expect, it, vi } from 'vitest';
import { saveProviderSessionId } from '@main/core/conversations/save-provider-session-id';
import { setProviderSessionId } from '@main/core/conversations/set-provider-session-id';
import { events } from '@main/lib/events';
import { conversationChangedChannel } from '@shared/core/conversations/conversationEvents';
import { enrichEvent } from './event-enricher';
import {
  extractProviderSessionId,
  handleProviderSessionHook,
} from './handle-provider-session-hook';

vi.mock('@main/core/conversations/save-provider-session-id', () => ({
  saveProviderSessionId: vi.fn(),
}));

vi.mock('@main/core/conversations/set-provider-session-id', () => ({
  setProviderSessionId: vi.fn(),
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('./event-enricher', () => ({
  enrichEvent: vi.fn(),
}));

const mockSaveProviderSessionId = vi.mocked(saveProviderSessionId);
const mockSetProviderSessionId = vi.mocked(setProviderSessionId);
const mockEvents = vi.mocked(events);
const mockEnrichEvent = vi.mocked(enrichEvent);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('extractProviderSessionId', () => {
  it('prefers snake-case provider session ids', () => {
    expect(
      extractProviderSessionId({
        session_id: 'grok-session-1',
        sessionId: 'grok-session-2',
      })
    ).toBe('grok-session-1');
  });

  it('falls back to camel-case session ids from Grok hook payloads', () => {
    expect(extractProviderSessionId({ sessionId: 'grok-session-3' })).toBe('grok-session-3');
  });

  it('returns undefined when no session id is present', () => {
    expect(extractProviderSessionId({ hookEventName: 'session_start' })).toBeUndefined();
  });
});

describe('handleProviderSessionHook', () => {
  it('persists Copilot session ids and emits conversation changes', async () => {
    mockSetProviderSessionId.mockResolvedValue(true);
    mockEnrichEvent.mockResolvedValue({
      type: 'start',
      providerId: 'copilot',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 0,
      payload: {},
    });

    await handleProviderSessionHook({
      ptyId: 'copilot-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ sessionId: 'copilot-session-1' }),
    });

    expect(mockSetProviderSessionId).toHaveBeenCalledWith('conversation-1', 'copilot-session-1');
    expect(mockEvents.emit).toHaveBeenCalledWith(conversationChangedChannel, {
      conversationId: 'conversation-1',
      taskId: 'task-1',
      projectId: 'project-1',
      changes: { providerSessionId: 'copilot-session-1' },
    });
  });

  it('persists Grok session ids and emits conversation changes', async () => {
    mockSetProviderSessionId.mockResolvedValue(true);
    mockEnrichEvent.mockResolvedValue({
      type: 'start',
      providerId: 'grok',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 0,
      payload: {},
    });

    await handleProviderSessionHook({
      ptyId: 'grok-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ sessionId: 'grok-session-1' }),
    });

    expect(mockSetProviderSessionId).toHaveBeenCalledWith('conversation-1', 'grok-session-1');
    expect(mockEvents.emit).toHaveBeenCalledWith(conversationChangedChannel, {
      conversationId: 'conversation-1',
      taskId: 'task-1',
      projectId: 'project-1',
      changes: { providerSessionId: 'grok-session-1' },
    });
  });

  it('persists OpenCode session ids and emits conversation changes', async () => {
    mockSetProviderSessionId.mockResolvedValue(true);
    mockEnrichEvent.mockResolvedValue({
      type: 'start',
      providerId: 'opencode',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 0,
      payload: {},
    });

    await handleProviderSessionHook({
      ptyId: 'opencode-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ sessionId: 'ses_7e7cTuaNc1DpuMrZrpUv4WRk0Z' }),
    });

    expect(mockSetProviderSessionId).toHaveBeenCalledWith(
      'conversation-1',
      'ses_7e7cTuaNc1DpuMrZrpUv4WRk0Z'
    );
    expect(mockEvents.emit).toHaveBeenCalledWith(conversationChangedChannel, {
      conversationId: 'conversation-1',
      taskId: 'task-1',
      projectId: 'project-1',
      changes: { providerSessionId: 'ses_7e7cTuaNc1DpuMrZrpUv4WRk0Z' },
    });
  });

  it('ignores OpenCode ids that are not session ids', async () => {
    await handleProviderSessionHook({
      ptyId: 'opencode-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ sessionId: 'msg_e8cbf36c300143krNXzZNt6AfZ' }),
    });

    expect(mockSetProviderSessionId).not.toHaveBeenCalled();
    expect(mockEvents.emit).not.toHaveBeenCalled();
  });

  it('skips enrichment when the Grok session id is already stored', async () => {
    mockSetProviderSessionId.mockResolvedValue(false);

    await handleProviderSessionHook({
      ptyId: 'grok-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ sessionId: 'grok-session-1' }),
    });

    expect(mockSetProviderSessionId).toHaveBeenCalledWith('conversation-1', 'grok-session-1');
    expect(mockEnrichEvent).not.toHaveBeenCalled();
    expect(mockEvents.emit).not.toHaveBeenCalled();
  });

  it('persists Kimi session ids from SessionStart hook payloads', async () => {
    mockSetProviderSessionId.mockResolvedValue(true);
    mockEnrichEvent.mockResolvedValue({
      type: 'start',
      providerId: 'kimi',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      timestamp: 0,
      payload: {},
    });

    await handleProviderSessionHook({
      ptyId: 'kimi-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ session_id: 'ses_kimi_1' }),
    });

    expect(mockSetProviderSessionId).toHaveBeenCalledWith('conversation-1', 'ses_kimi_1');
    expect(mockEvents.emit).toHaveBeenCalledWith(conversationChangedChannel, {
      conversationId: 'conversation-1',
      taskId: 'task-1',
      projectId: 'project-1',
      changes: { providerSessionId: 'ses_kimi_1' },
    });
  });

  it('keeps Droid session ids on the Droid validation path', async () => {
    await handleProviderSessionHook({
      ptyId: 'droid-conv-conversation-1',
      type: 'session',
      body: JSON.stringify({ session_id: '31477a03-961a-4451-82d4-efded56947fc' }),
    });

    expect(mockSaveProviderSessionId).toHaveBeenCalledWith(
      'conversation-1',
      '31477a03-961a-4451-82d4-efded56947fc'
    );
    expect(mockSetProviderSessionId).not.toHaveBeenCalled();
  });
});
