import { describe, expect, it } from 'vitest';
import {
  appendInitialConversationText,
  buildFinalPrompt,
} from '@renderer/features/tasks/create-task-modal/initial-conversation-text';

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

describe('buildFinalPrompt', () => {
  it('returns only the user prompt when there is no issue context', () => {
    expect(buildFinalPrompt(null, 'Fix the bug.')).toBe('Fix the bug.');
  });

  it('wraps issue context in XML tags and prepends it before user text', () => {
    expect(buildFinalPrompt('Provider: Linear | Identifier: ENG-1', 'Fix the bug.')).toBe(
      '<issue_context>\nProvider: Linear | Identifier: ENG-1\n</issue_context>\n\nFix the bug.'
    );
  });

  it('returns only the issue context block when user prompt is empty', () => {
    expect(buildFinalPrompt('Provider: Linear | Identifier: ENG-1', '')).toBe(
      '<issue_context>\nProvider: Linear | Identifier: ENG-1\n</issue_context>'
    );
  });

  it('returns undefined when both issue context and user prompt are empty', () => {
    expect(buildFinalPrompt(null, '')).toBeUndefined();
    expect(buildFinalPrompt('', '  ')).toBeUndefined();
  });

  it('trims whitespace from both parts', () => {
    expect(buildFinalPrompt('  context  ', '  prompt  ')).toBe(
      '<issue_context>\ncontext\n</issue_context>\n\nprompt'
    );
  });
});
