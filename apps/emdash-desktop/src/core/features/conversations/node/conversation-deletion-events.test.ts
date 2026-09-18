import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationRemovalBroker } from '@core/features/conversations/api/node/operations/conversation-removal';
import type { AppDb } from '@core/services/app-db/node/db';
import { deleteHostConversation } from './delete-host-conversation';
import { deleteConversation } from './deleteConversation';

const { emit, remove, getLive } = vi.hoisted(() => ({
  emit: vi.fn(),
  remove: vi.fn(),
  getLive: vi.fn(),
}));

vi.mock('./event-host', () => ({ conversationWireEvents: { emit } }));
vi.mock('./remove-conversation', () => ({ removeConversationOrTombstone: remove }));
vi.mock('@core/features/conversations/api/node/conversation-events', () => ({
  conversationEvents: { _emit: vi.fn() },
}));
vi.mock('@core/services/app-db/node/pokes', () => ({
  appDbPokes: { conversations: { poke: vi.fn() } },
}));
vi.mock('@core/features/conversations/api/node/registry', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createConversationRegistry: () => ({ getLive }),
}));

const row = {
  id: 'conversation-1',
  projectId: 'project-1',
  taskId: 'task-1',
  location: 'local',
  sshConnectionId: null,
};
const runtimes: ConversationRemovalBroker = { client: vi.fn() };
const telemetry = { capture: vi.fn() };
const db = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => {
          const record = getLive();
          return record ? [record] : [];
        },
      }),
    }),
  }),
} as unknown as AppDb;

beforeEach(() => {
  vi.resetAllMocks();
  getLive.mockReturnValue(row);
  remove.mockResolvedValue('removed');
});

describe.each(['task', 'machine'] as const)('%s conversation deletion events', (surface) => {
  const deleteFromSurface = () =>
    surface === 'task'
      ? deleteConversation(db, runtimes, row.projectId, row.taskId, row.id, telemetry)
      : deleteHostConversation(db, runtimes, row.id, telemetry);

  it.each(['removed', 'tombstoned'])(
    'publishes task membership removal after the record is %s',
    async (outcome) => {
      remove.mockResolvedValue(outcome);
      await deleteFromSurface();
      expect(emit).toHaveBeenCalledExactlyOnceWith(undefined, {
        type: 'deleted',
        conversationId: row.id,
        projectId: row.projectId,
        taskId: row.taskId,
      });
    }
  );

  it('does not publish a deletion when removal fails', async () => {
    remove.mockRejectedValue(new Error('Host rejected deletion'));
    await expect(deleteFromSurface()).rejects.toThrow('Host rejected deletion');
    expect(emit).not.toHaveBeenCalled();
  });

  it('does not publish a second deletion for an absent record', async () => {
    getLive.mockReturnValue(undefined);
    await deleteFromSurface();
    expect(emit).not.toHaveBeenCalled();
  });
});

it('does not invent a task notification for an unlinked host conversation', async () => {
  getLive.mockReturnValue({ ...row, taskId: null, projectId: null });
  await deleteHostConversation(db, runtimes, row.id, telemetry);
  expect(remove).toHaveBeenCalledOnce();
  expect(emit).not.toHaveBeenCalled();
});
