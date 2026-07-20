import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRow } from '@core/services/app-db/node/schema';
import { launchTuiConversation } from './launch-tui-conversation';

const resolveTask = vi.hoisted(() => vi.fn());
const emit = vi.hoisted(() => vi.fn());
const capture = vi.hoisted(() => vi.fn());

vi.mock('../projects/utils', () => ({ resolveTask }));
vi.mock('@core/features/conversations/node', () => ({
  conversationWireEvents: { emit },
}));
vi.mock('@main/lib/telemetry', () => ({ telemetryService: { capture } }));
vi.mock('@main/lib/logger', () => ({ log: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

describe('launchTuiConversation', () => {
  beforeEach(() => {
    resolveTask.mockReset();
    emit.mockReset();
    capture.mockReset();
  });

  it('starts first-spawn conversations and persists the placeholder afterward', async () => {
    const row = conversationRow({ sessionId: null });
    const database = fakeDatabase(row);
    const ensureSession = vi.fn(() => Promise.resolve({ outcome: 'started' as const }));
    resolveTask.mockReturnValue({
      conversations: {
        ensureSession,
        stopSession: vi.fn(),
      },
    });

    const result = await launchTuiConversation({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      database: database as never,
    });

    expect(ensureSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'start',
        initialPrompt: 'hello',
      })
    );
    expect(row.sessionId).toBe('conversation-1');
    expect(result.conversation.sessionId).toBe('conversation-1');
    expect(emit).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({
        conversationId: 'conversation-1',
        changes: { sessionId: 'conversation-1' },
      })
    );
  });

  it('does not overwrite a native provider session id written during launch', async () => {
    const row = conversationRow({ sessionId: null });
    const database = fakeDatabase(row);
    const ensureSession = vi.fn(async () => {
      row.sessionId = 'native-session';
      return { outcome: 'started' as const };
    });
    resolveTask.mockReturnValue({
      conversations: {
        ensureSession,
        stopSession: vi.fn(),
      },
    });

    const result = await launchTuiConversation({
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      database: database as never,
    });

    expect(row.sessionId).toBe('native-session');
    expect(result.conversation.sessionId).toBe('native-session');
    expect(emit).not.toHaveBeenCalled();
  });
});

function fakeDatabase(row: ConversationRow) {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [row],
        }),
      }),
    }),
    update: () => ({
      set: (values: Partial<ConversationRow>) => ({
        where: () => ({
          returning: async () => {
            if (row.sessionId !== null) return [];
            Object.assign(row, values);
            return [{ sessionId: row.sessionId }];
          },
        }),
      }),
    }),
  };
}

function conversationRow(overrides: Partial<ConversationRow>): ConversationRow {
  return {
    id: 'conversation-1',
    projectId: 'project-1',
    taskId: 'task-1',
    title: 'Conversation',
    provider: 'claude',
    sessionId: null,
    config: {
      version: '1',
      type: 'pty',
      initialPrompt: 'hello',
    },
    isInitialConversation: false,
    type: 'pty',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastInteractedAt: null,
    agentStatus: null,
    agentStatusSeen: 1,
    ...overrides,
  } as ConversationRow;
}
