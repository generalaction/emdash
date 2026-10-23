import { describe, expect, it } from 'vitest';
import type { LineCommentLike } from '@core/primitives/line-comments/api';
import { appendDraftCommentsContext } from './draft-comments-context';

const comment: LineCommentLike = {
  filePath: 'src/a.ts',
  target: { kind: 'working-tree', group: 'disk', path: 'src/a.ts' },
  lineNumber: 3,
  content: 'Rename this',
};

describe('appendDraftCommentsContext', () => {
  it('passes the base context through when there are no comments', async () => {
    await expect(appendDraftCommentsContext(Promise.resolve('issue'), [])).resolves.toBe('issue');
    await expect(appendDraftCommentsContext(Promise.resolve(undefined), [])).resolves.toBe(
      undefined
    );
  });

  it('returns only the formatted comments when there is no base context', async () => {
    const result = await appendDraftCommentsContext(Promise.resolve(undefined), [comment]);
    expect(result).toContain('The user has left the following comments');
    expect(result).toContain('<comment line="3">Rename this</comment>');
  });

  it('appends the comments after the base context', async () => {
    const result = await appendDraftCommentsContext(Promise.resolve('<issue_context/>'), [comment]);
    expect(result?.startsWith('<issue_context/>\n\n')).toBe(true);
    expect(result).toContain('path="src/a.ts"');
  });
});
