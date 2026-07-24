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
        version: '1',
        groups: [],
        activeGroupId: '',
        paneSizes: [],
      }).status
    ).toBe('invalid');
  });
});
