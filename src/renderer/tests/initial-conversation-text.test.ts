import { describe, expect, it } from 'vitest';
import {
  appendInitialConversationText,
  hasInitialIssueContext,
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
  it('appends issue context without wrapper tags', () => {
    expect(upsertInitialIssueContext('Existing instructions.', 'Provider: Linear')).toBe(
      'Existing instructions.\nProvider: Linear'
    );
  });

  it('replaces an existing legacy issue context block without changing user text', () => {
    const prompt = [
      'Existing instructions.',
      '<issue_context>',
      'Provider: Linear | Identifier: ENG-1',
      '</issue_context>',
      'Keep this line.',
    ].join('\n');

    expect(upsertInitialIssueContext(prompt, 'Provider: Linear | Identifier: ENG-2')).toBe(
      [
        'Existing instructions.',
        'Provider: Linear | Identifier: ENG-2',
        'Keep this line.',
      ].join('\n')
    );
  });

  it('replaces the only issue context block in the prompt', () => {
    const prompt = '<issue_context>\nProvider: Linear | Identifier: ENG-0\n</issue_context>';

    expect(upsertInitialIssueContext(prompt, 'Provider: Linear | Identifier: ENG-1')).toBe(
      'Provider: Linear | Identifier: ENG-1'
    );
  });

  it('preserves blank lines around an existing legacy issue context block', () => {
    const prompt = [
      'Existing instructions.',
      '',
      '<issue_context>',
      'Provider: Linear | Identifier: ENG-1',
      '</issue_context>',
      '',
      'Keep this line.',
    ].join('\n');

    expect(upsertInitialIssueContext(prompt, 'Provider: Linear | Identifier: ENG-2')).toBe(
      [
        'Existing instructions.',
        '',
        'Provider: Linear | Identifier: ENG-2',
        '',
        'Keep this line.',
      ].join('\n')
    );
  });
});

describe('hasInitialIssueContext', () => {
  it('detects issue context blocks', () => {
    expect(hasInitialIssueContext('<issue_context>\nProvider: Linear\n</issue_context>')).toBe(true);
    expect(hasInitialIssueContext('Provider: Linear. Identifier: ENG-1')).toBe(true);
    expect(hasInitialIssueContext('Existing instructions.')).toBe(false);
  });
});
