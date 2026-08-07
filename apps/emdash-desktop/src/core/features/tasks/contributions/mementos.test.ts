import { describe, expect, it } from 'vitest';
import { taskPaneLayoutMemento, taskPaneLayoutSchema } from './mementos';

describe('task pane layout memento', () => {
  it('uses a safe one-pane default', () => {
    expect(taskPaneLayoutMemento.default.groups).toHaveLength(1);
    expect(taskPaneLayoutSchema.safeParse(taskPaneLayoutMemento.default).status).toBe('ok');
  });

  it('rejects layouts without a pane', () => {
    expect(
      taskPaneLayoutSchema.safeParse({
        version: '2',
        groups: [],
        activeGroupId: '',
      }).status
    ).toBe('invalid');
  });

  it('upgrades a v1 document by dropping the abandoned paneSizes', () => {
    const result = taskPaneLayoutSchema.safeParse({
      version: '1',
      groups: [{ groupId: 'a', tabManager: { tabs: [] } }],
      activeGroupId: 'a',
      paneSizes: [100],
    });
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.data).toEqual({
        version: '2',
        groups: [{ groupId: 'a', tabManager: { tabs: [] } }],
        activeGroupId: 'a',
      });
    }
  });
});
