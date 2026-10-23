import { describe, expect, it } from 'vitest';
import { multitaskLayoutMemento, multitaskLayoutSchema } from './mementos';

describe('multitask layout memento', () => {
  it('uses a valid layout with no minimized chats by default', () => {
    expect(multitaskLayoutSchema.safeParse(multitaskLayoutMemento.default).status).toBe('ok');
    expect(multitaskLayoutMemento.default.minimizedCellKeys).toEqual([]);
  });

  it('upgrades v1 layouts without losing selected cells', () => {
    const result = multitaskLayoutSchema.safeParse({
      version: '1',
      cells: [{ projectId: 'project', taskId: 'task', conversationId: 'conversation' }],
      columns: 2,
      liveOnly: true,
    });

    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data).toEqual({
        version: '2',
        cells: [{ projectId: 'project', taskId: 'task', conversationId: 'conversation' }],
        columns: 2,
        liveOnly: true,
        minimizedCellKeys: [],
      });
    }
  });
});
