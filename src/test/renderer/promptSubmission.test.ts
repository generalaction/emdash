import { beforeEach, describe, expect, it } from 'vitest';
import { buildCommentScopeKey, draftCommentsStore } from '../../renderer/lib/DraftCommentsStore';
import {
  consumePromptComments,
  preparePromptSubmission,
} from '../../renderer/lib/promptSubmission';

describe('promptSubmission helpers', () => {
  const taskId = 'task-1';
  const taskPath = '/tmp/worktree';
  const scopeKey = buildCommentScopeKey(taskId, taskPath);

  beforeEach(() => {
    draftCommentsStore.consumeAll(scopeKey);
  });

  it('passes slash commands through without comment injection', () => {
    draftCommentsStore.add(scopeKey, {
      filePath: 'src/app.ts',
      lineNumber: 10,
      lineContent: 'const value = 1;',
      content: 'Check this edge case.',
    });

    const result = preparePromptSubmission({
      prompt: '/model',
      taskId,
      taskPath,
    });

    expect(result.text).toBe('/model');
    expect(result.isSlashCommand).toBe(true);
    expect(result.commentScopeKey).toBeNull();
  });

  it('appends queued review comments to normal prompts', () => {
    draftCommentsStore.add(scopeKey, {
      filePath: 'src/app.ts',
      lineNumber: 10,
      lineContent: 'const value = 1;',
      content: 'Check this edge case.',
    });

    const result = preparePromptSubmission({
      prompt: 'Please fix this',
      taskId,
      taskPath,
    });

    expect(result.text).toContain('Please fix this');
    expect(result.text).toContain('<user_comments>');
    expect(result.commentScopeKey).toBe(scopeKey);
  });

  it('consumes pending comments only after a successful injection', () => {
    draftCommentsStore.add(scopeKey, {
      filePath: 'src/app.ts',
      lineNumber: 10,
      lineContent: 'const value = 1;',
      content: 'Check this edge case.',
    });

    consumePromptComments(scopeKey, false);
    expect(draftCommentsStore.getCount(scopeKey)).toBe(1);

    consumePromptComments(scopeKey, true);
    expect(draftCommentsStore.getCount(scopeKey)).toBe(0);
  });
});
