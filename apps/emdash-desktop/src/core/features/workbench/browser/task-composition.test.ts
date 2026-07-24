import { describe, expect, it } from 'vitest';
import { sanitizeDiffSelection } from './task-composition-state';

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
