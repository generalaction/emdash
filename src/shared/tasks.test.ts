import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  formatIssueAsPrompt,
  generateChatName,
  taskSidebarGroupForKind,
  taskViewProfile,
  type Issue,
} from './tasks';

describe('Issue', () => {
  it('supports provider-specific branch names', () => {
    const issue: Issue = {
      provider: 'linear',
      url: 'https://linear.app/general-action/issue/GEN-626',
      title: 'Linear issue branch name creation',
      identifier: 'GEN-626',
      branchName: 'jona/gen-626-linear-issue-branch-name-creation',
    };

    expect(issue.branchName).toBe('jona/gen-626-linear-issue-branch-name-creation');
    expectTypeOf(issue.branchName).toEqualTypeOf<string | undefined>();
  });

  it('includes provider-specific context in issue prompts', () => {
    const issue: Issue = {
      provider: 'linear',
      url: 'https://linear.app/general-action/issue/GEN-626',
      title: 'Linear issue branch name creation',
      identifier: 'GEN-626',
      description: 'Use the Linear branch format',
      context: 'Linear issue activity\n\nComments:\n- 2026-04-17 by Jona: Looks good',
    };

    expect(formatIssueAsPrompt(issue)).toContain('Linear issue activity');
    expect(formatIssueAsPrompt(issue)).toContain('Looks good');
  });
});

describe('generateChatName', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a chat-prefixed name with the current month and day', () => {
    vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('May');
    const name = generateChatName(new Date('2026-05-27T12:00:00Z'));
    expect(name).toBe('chat-may-27');
  });

  it('returns different names on different days', () => {
    vi.spyOn(Date.prototype, 'toLocaleString')
      .mockReturnValueOnce('May')
      .mockReturnValueOnce('Jun');
    const may = generateChatName(new Date('2026-05-27T12:00:00Z'));
    const june = generateChatName(new Date('2026-06-01T12:00:00Z'));
    expect(may).not.toBe(june);
  });
});

describe('taskSidebarGroupForKind', () => {
  it('maps task kind to tasks group', () => {
    expect(taskSidebarGroupForKind('task')).toBe('tasks');
  });

  it('maps chat kind to chats group', () => {
    expect(taskSidebarGroupForKind('chat')).toBe('chats');
  });
});

describe('taskViewProfile', () => {
  it('hides git and file chrome for chats', () => {
    expect(taskViewProfile('chat')).toEqual({
      group: 'chats',
      showGitChrome: false,
      showChangesSidebar: false,
      showFilesSidebar: false,
      showFilePicker: false,
    });
  });

  it('shows full chrome for tasks', () => {
    expect(taskViewProfile('task').group).toBe('tasks');
    expect(taskViewProfile('task').showGitChrome).toBe(true);
  });
});
