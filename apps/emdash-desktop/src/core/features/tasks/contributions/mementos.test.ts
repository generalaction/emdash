import { describe, expect, it } from 'vitest';
import { taskDiffSelectionSchema, taskPaneLayoutMemento, taskPaneLayoutSchema } from './mementos';

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
        version: '3',
        groups: [{ groupId: 'a', tabManager: { tabs: [] } }],
        activeGroupId: 'a',
      });
    }
  });

  it('rejects absolute diff-tab paths', () => {
    const result = taskPaneLayoutSchema.safeParse({
      version: '2',
      groups: [
        {
          groupId: 'a',
          tabManager: {
            tabs: [
              {
                kind: 'diff',
                tabId: 'diff-1',
                path: '/repo/src/index.ts',
                diffGroup: 'disk',
                originalRef: { kind: 'commit', sha: 'HEAD' },
                isPreview: false,
              },
            ],
            activeTabId: 'diff-1',
          },
        },
      ],
      activeGroupId: 'a',
    });

    expect(result.status).toBe('invalid');
  });
});

describe('task diff selection memento', () => {
  it('upgrades old selections and preserves checkout identity in new selections', () => {
    const old = taskDiffSelectionSchema.safeParse({ version: '1' });
    expect(old).toMatchObject({ status: 'ok', data: { version: '2' } });
    const result = taskDiffSelectionSchema.safeParse({
      version: '2',
      selectedWorkspaceId: 'subagent',
      activeFile: {
        workspaceId: 'subagent',
        path: 'src/index.ts',
        type: 'disk',
        group: 'disk',
        originalRef: { kind: 'commit', sha: 'HEAD' },
      },
    });
    expect(result).toMatchObject({
      status: 'ok',
      data: { selectedWorkspaceId: 'subagent', activeFile: { workspaceId: 'subagent' } },
    });
  });
  it('rejects absolute active diff paths', () => {
    const result = taskDiffSelectionSchema.safeParse({
      version: '1',
      activeFile: {
        path: '/repo/src/index.ts',
        type: 'disk',
        group: 'disk',
        originalRef: { kind: 'commit', sha: 'HEAD' },
      },
    });

    expect(result.status).toBe('invalid');
  });
});
