import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makePtyId } from '@shared/ptyId';
import { enrichEvent } from './event-enricher';

const mockLimit = vi.hoisted(() => vi.fn());

vi.mock('@main/db/client', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mockLimit,
        })),
      })),
    })),
  },
}));

describe('enrichEvent', () => {
  beforeEach(() => {
    mockLimit.mockReset();
    mockLimit.mockResolvedValue([{ taskId: 'task-1', projectId: 'project-1' }]);
  });

  it('accepts Claude stop hooks with empty stdin', async () => {
    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'conversation-1'),
      type: 'stop',
      body: '',
    });

    expect(event).toMatchObject({
      type: 'stop',
      providerId: 'claude',
      projectId: 'project-1',
      taskId: 'task-1',
      conversationId: 'conversation-1',
      payload: {},
    });
  });

  it('accepts Claude hooks with plain text stdin', async () => {
    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'conversation-1'),
      type: 'stop',
      body: 'Done',
    });

    expect(event.payload.message).toBe('Done');
  });

  it('treats Claude notifications without an explicit notification type as permission_prompt', async () => {
    const event = await enrichEvent({
      ptyId: makePtyId('claude', 'conversation-1'),
      type: 'notification',
      body: '{"message":"Claude needs input"}',
    });

    expect(event.payload).toMatchObject({
      message: 'Claude needs input',
      notificationType: 'permission_prompt',
    });
  });
});
