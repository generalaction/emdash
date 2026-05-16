import { describe, expect, it } from 'vitest';
import { appendInitialConversationText } from '@renderer/features/tasks/create-task-modal/initial-conversation-text';

describe('appendInitialConversationText', () => {
  it('uses the selected text when the prompt is empty', () => {
    expect(appendInitialConversationText('', 'Review this worktree.')).toBe(
      'Review this worktree.'
    );
  });

  it('appends selected text to existing prompt content', () => {
    expect(appendInitialConversationText('Existing instructions.', 'Review this worktree.')).toBe(
      'Existing instructions.\nReview this worktree.'
    );
  });

  it('ignores empty selected text', () => {
    expect(appendInitialConversationText('Existing instructions.', '   ')).toBe(
      'Existing instructions.'
    );
  });
});
