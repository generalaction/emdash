import { describe, expect, it } from 'vitest';
import {
  taskChromeMemento,
  taskChromeSchema,
  taskDiffSelectionSchema,
  taskPaneLayoutMemento,
  taskPaneLayoutSchema,
} from './mementos';

describe('task chrome memento', () => {
  it('defaults and upgrades the terminal dock to the bottom', () => {
    expect(taskChromeMemento.default.terminalDockPosition).toBe('bottom');
    expect(
      taskChromeSchema.safeParse({
        version: '1',
        sidebarTab: 'files',
        sidebarCollapsed: false,
        terminalDrawerOpen: true,
      })
    ).toEqual({
      status: 'ok',
      data: {
        version: '2',
        sidebarTab: 'files',
        sidebarCollapsed: false,
        terminalDrawerOpen: true,
        terminalDockPosition: 'bottom',
      },
    });
  });
});

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
