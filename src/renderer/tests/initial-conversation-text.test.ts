import { describe, expect, it } from 'vitest';
import {
  appendInitialConversationText,
  formatInitialIssueContextBlock,
  upsertInitialIssueContext,
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

describe('upsertInitialIssueContext', () => {
  it('appends issue context as a replaceable block', () => {
    expect(upsertInitialIssueContext('Existing instructions.', 'Provider: Linear')).toBe(
      'Existing instructions.\n<issue_context>\nProvider: Linear\n</issue_context>'
    );
  });

  it('replaces an existing issue context block without changing user text', () => {
    const prompt = [
      'Existing instructions.',
      formatInitialIssueContextBlock('Provider: Linear | Identifier: ENG-1'),
      'Keep this line.',
    ].join('\n');

    expect(upsertInitialIssueContext(prompt, 'Provider: Linear | Identifier: ENG-2')).toBe(
      [
        'Existing instructions.',
        '<issue_context>',
        'Provider: Linear | Identifier: ENG-2',
        '</issue_context>',
        'Keep this line.',
      ].join('\n')
    );
  });

  it('replaces the only issue context block in the prompt', () => {
    const prompt = upsertInitialIssueContext('', 'Provider: Linear | Identifier: ENG-0');

    expect(upsertInitialIssueContext(prompt, 'Provider: Linear | Identifier: ENG-1')).toBe(
      '<issue_context>\nProvider: Linear | Identifier: ENG-1\n</issue_context>'
    );
  });
});
