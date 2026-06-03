import { describe, expect, it } from 'vitest';
import {
  formatCommentsForAgent,
  getDraftCommentTargetKey,
  type DraftCommentTarget,
  type LineCommentLike,
} from './lineComments';

function comment(target: DraftCommentTarget, content: string): LineCommentLike {
  return {
    filePath: target.path,
    target,
    targetKey: getDraftCommentTargetKey(target),
    lineNumber: 10,
    content,
  };
}

describe('formatCommentsForAgent', () => {
  it('groups comments by exact diff target and includes commit metadata', () => {
    const targetA: DraftCommentTarget = {
      kind: 'commit',
      originalSha: 'aaa111',
      modifiedSha: 'bbb222',
      path: 'foo.ts',
    };
    const targetB: DraftCommentTarget = {
      kind: 'commit',
      originalSha: 'ccc333',
      modifiedSha: 'ddd444',
      path: 'foo.ts',
    };

    const formatted = formatCommentsForAgent([
      comment(targetA, 'Comment for commit A'),
      comment(targetB, 'Comment for commit B'),
    ]);

    expect(formatted).toContain(
      '<target kind="commit" originalSha="aaa111" modifiedSha="bbb222" path="foo.ts">'
    );
    expect(formatted).toContain(
      '<target kind="commit" originalSha="ccc333" modifiedSha="ddd444" path="foo.ts">'
    );
    expect(formatted).toContain('Comment for commit A');
    expect(formatted).toContain('Comment for commit B');
  });

  it('includes PR and working-tree target metadata', () => {
    const prTarget: DraftCommentTarget = {
      kind: 'pr',
      prNumber: 42,
      baseOid: 'base123',
      headOid: 'head456',
      path: 'foo.ts',
    };
    const diskTarget: DraftCommentTarget = {
      kind: 'working-tree',
      group: 'disk',
      path: 'foo.ts',
    };

    const formatted = formatCommentsForAgent([
      comment(prTarget, 'PR comment'),
      comment(diskTarget, 'Working tree comment'),
    ]);

    expect(formatted).toContain(
      '<target kind="pr" prNumber="42" baseOid="base123" headOid="head456" path="foo.ts">'
    );
    expect(formatted).toContain('<target kind="working-tree" group="disk" path="foo.ts">');
  });

  it('escapes XML in paths and comment content', () => {
    const target: DraftCommentTarget = {
      kind: 'working-tree',
      group: 'disk',
      path: 'src/a&b.ts',
    };

    const formatted = formatCommentsForAgent([comment(target, 'Use <safe> & "clear" text')]);

    expect(formatted).toContain('path="src/a&amp;b.ts"');
    expect(formatted).toContain('Use &lt;safe&gt; &amp; "clear" text');
  });
});
