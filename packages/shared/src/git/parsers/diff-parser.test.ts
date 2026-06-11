import { describe, expect, it } from 'vitest';
import { mapGitChangeStatus, parseDiffLines } from './diff-parser';

describe('diff parser', () => {
  it('parses text diff hunks while skipping git headers', () => {
    const diff = [
      'diff --git a/a.txt b/a.txt',
      'index 1111111..2222222 100644',
      '--- a/a.txt',
      '+++ b/a.txt',
      '@@ -1,2 +1,2 @@',
      ' unchanged',
      '-old',
      '+new',
      '\\ No newline at end of file',
      '',
    ].join('\n');

    expect(parseDiffLines(diff)).toEqual({
      isBinary: false,
      lines: [
        { left: 'unchanged', right: 'unchanged', type: 'context' },
        { left: 'old', type: 'del' },
        { right: 'new', type: 'add' },
      ],
    });
  });

  it('detects binary diffs and maps git status codes', () => {
    expect(parseDiffLines('Binary files a/image.png and b/image.png differ\n')).toEqual({
      isBinary: true,
      lines: [],
    });

    expect(mapGitChangeStatus('??')).toBe('added');
    expect(mapGitChangeStatus(' D')).toBe('deleted');
    expect(mapGitChangeStatus('R100')).toBe('renamed');
    expect(mapGitChangeStatus('UU')).toBe('conflicted');
    expect(mapGitChangeStatus(' M')).toBe('modified');
  });
});
