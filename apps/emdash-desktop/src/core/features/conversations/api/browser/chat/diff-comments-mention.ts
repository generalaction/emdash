import { AT_BARE_PATTERN } from '@emdash/shared/markdown';

export const diffCommentsMention = {
  id: 'context:diff-comments',
  label: 'context:diff-comments',
  name: 'Diff comments',
  kind: 'custom' as const,
};

export function hasDiffCommentsMention(text: string): boolean {
  for (const match of text.matchAll(new RegExp(AT_BARE_PATTERN, 'g'))) {
    if (match[1] === diffCommentsMention.id) return true;
  }
  return false;
}
