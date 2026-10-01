import { stringifyMention } from '@emdash/shared/markdown';
import { describe, expect, it } from 'vitest';
import { diffCommentsMention, hasDiffCommentsMention } from './diff-comments-mention';

describe('hasDiffCommentsMention', () => {
  it('recognizes the token serialized by the composer', () => {
    const mention = stringifyMention({
      label: diffCommentsMention.name,
      target: diffCommentsMention.label,
      kind: diffCommentsMention.kind,
    });
    expect(hasDiffCommentsMention(`Address ${mention}, please.`)).toBe(true);
    expect(hasDiffCommentsMention(mention)).toBe(true);
  });

  it.each([
    'Explain these changes',
    'Diff comments',
    'context:diff-comments',
    '@context:diff-comments-extra',
    '@context:diff-comments.ts',
    '@[diff-comments](src/diff-comments.ts)',
  ])('does not attach drafts for %s', (text) => {
    expect(hasDiffCommentsMention(text)).toBe(false);
  });
});
