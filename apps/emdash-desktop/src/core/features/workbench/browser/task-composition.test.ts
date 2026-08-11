import { describe, expect, it, vi } from 'vitest';
import { deleteSplitPaneLayoutEntries, sanitizeDiffSelection } from './task-composition-state';

describe('task composition diff selection hydration', () => {
  it('normalizes a persisted workspace-relative path', () => {
    expect(
      sanitizeDiffSelection(
        {
          version: '1',
          activeFile: {
            path: 'src/index.ts',
            type: 'disk',
            group: 'disk',
            originalRef: { kind: 'commit', sha: 'HEAD' },
          },
        },
        {
          workspacePath: '/tmp/workspace',
          validPaths: new Set(['src/index.ts']),
        }
      ).activeFile?.path
    ).toBe('/tmp/workspace/src/index.ts');
  });

  it('drops a stale persisted working-tree selection', () => {
    expect(
      sanitizeDiffSelection(
        {
          version: '1',
          activeFile: {
            path: '/tmp/workspace/deleted.ts',
            type: 'disk',
            group: 'disk',
            originalRef: { kind: 'commit', sha: 'HEAD' },
          },
        },
        {
          workspacePath: '/tmp/workspace',
          validPaths: new Set(),
        }
      ).activeFile
    ).toBeUndefined();
  });
});

describe('split-pane layout cleanup on pane group destroy', () => {
  const paneA = '11111111-1111-4111-8111-111111111111';
  const paneB = '22222222-2222-4222-8222-222222222222';
  const paneC = '33333333-3333-4333-8333-333333333333';
  const entryKey = (...paneIds: string[]) =>
    `react-resizable-panels:task-main-split:${paneIds.map((id) => `pane:${id}`).join(':')}`;

  it('deletes every entry referencing the destroyed pane group and keeps the rest', () => {
    const deleteEntry = vi.fn();
    const keys = [
      entryKey(paneA, paneB),
      entryKey(paneA, paneB, paneC),
      entryKey(paneA, paneC),
      'react-resizable-panels:task-main-vertical:task-main-content:task-terminal-drawer',
    ];

    deleteSplitPaneLayoutEntries({ deleteEntry }, keys, paneB);

    expect(deleteEntry.mock.calls.map(([key]) => key)).toEqual([
      entryKey(paneA, paneB),
      entryKey(paneA, paneB, paneC),
    ]);
  });

  it('is a no-op when no entry references the pane group', () => {
    const deleteEntry = vi.fn();

    deleteSplitPaneLayoutEntries(
      { deleteEntry },
      [entryKey(paneA, paneB), 'react-resizable-panels:workspace-outer'],
      paneC
    );

    expect(deleteEntry).not.toHaveBeenCalled();
  });
});
