import { describe, expect, it, vi } from 'vitest';
import type { ConversationConfig } from '@shared/core/conversations/conversation-config';
import { setConversationModeId } from './set-mode-id';

vi.mock('@main/db/client', () => ({ db: {} }));

type FakeRow = {
  config: ConversationConfig | null;
  projectId: string;
  taskId: string;
};

describe('setConversationModeId', () => {
  it('rejects an empty mode id', async () => {
    const { database } = fakeDatabase(acpRow());

    const result = await setConversationModeId('conversation-1', '  ', database as never);

    expect(result).toEqual({ success: false, error: { type: 'empty-mode-id' } });
  });

  it('returns conversation-not-found when the row is missing', async () => {
    const { database } = fakeDatabase(undefined);

    const result = await setConversationModeId('conversation-1', 'agent', database as never);

    expect(result).toMatchObject({ success: false, error: { type: 'conversation-not-found' } });
  });

  it('rejects non-ACP conversations', async () => {
    const { database } = fakeDatabase({
      config: { version: '1', type: 'pty' },
      projectId: 'project-1',
      taskId: 'task-1',
    });

    const result = await setConversationModeId('conversation-1', 'agent', database as never);

    expect(result).toMatchObject({ success: false, error: { type: 'not-acp-conversation' } });
  });

  it('writes the mode id into the ACP config and preserves other fields', async () => {
    const row = acpRow({ model: 'claude-sonnet-5' });
    const { database, updates } = fakeDatabase(row);

    const result = await setConversationModeId(
      'conversation-1',
      'agent-full-access',
      database as never
    );

    expect(result).toEqual({
      success: true,
      data: { projectId: 'project-1', taskId: 'task-1' },
    });
    expect(updates).toHaveLength(1);
    expect(updates[0]?.config).toEqual({
      version: '1',
      type: 'acp',
      model: 'claude-sonnet-5',
      modeId: 'agent-full-access',
    });
    expect(updates[0]?.updatedAt).toEqual(expect.any(String));
  });

  it('skips the write when the mode id is unchanged', async () => {
    const row = acpRow({ modeId: 'agent' });
    const { database, updates } = fakeDatabase(row);

    const result = await setConversationModeId('conversation-1', 'agent', database as never);

    expect(result).toEqual({
      success: true,
      data: { projectId: 'project-1', taskId: 'task-1' },
    });
    expect(updates).toHaveLength(0);
  });
});

function acpRow(config: Partial<ConversationConfig> = {}): FakeRow {
  return {
    config: { version: '1', type: 'acp', ...config } as ConversationConfig,
    projectId: 'project-1',
    taskId: 'task-1',
  };
}

function fakeDatabase(row: FakeRow | undefined) {
  const updates: Array<Record<string, unknown>> = [];
  const database = {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (row ? [row] : []),
        }),
      }),
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
        },
      }),
    }),
  };
  return { database, updates };
}
