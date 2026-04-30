import { describe, expect, it } from 'vitest';
import type { PromptTemplate } from '@shared/prompt-templates';
import type { Issue } from '@shared/tasks';
import {
  buildDraftCommentsContextAction,
  buildLinkedIssueContextAction,
  buildPromptTemplateContextActions,
  buildTaskContextActions,
} from '@renderer/features/tasks/conversations/context-actions';

function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    provider: 'github',
    identifier: 'EMD-123',
    title: 'Fix task context injection behavior',
    url: 'https://example.com/issues/EMD-123',
    description: 'Ensure issue context can be injected from the context bar.',
    status: 'In Progress',
    assignees: ['alice', 'bob'],
    project: 'Infra',
    updatedAt: '2026-04-15T11:27:38.662Z',
    fetchedAt: '2026-04-15T15:49:46.788Z',
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<PromptTemplate> = {}): PromptTemplate {
  return {
    id: 't1',
    name: 'Review',
    text: 'Review this worktree for issues.',
    sortOrder: 0,
    createdAt: '2026-04-15T11:27:38.662Z',
    updatedAt: '2026-04-15T11:27:38.662Z',
    ...overrides,
  };
}

describe('buildLinkedIssueContextAction', () => {
  it('returns null when no issue is linked', () => {
    expect(buildLinkedIssueContextAction(undefined)).toBeNull();
  });

  it('builds an inject action with provider metadata and compact label', () => {
    const action = buildLinkedIssueContextAction(makeIssue());

    expect(action).not.toBeNull();
    expect(action?.id).toBe('linked-issue:github:EMD-123');
    expect(action?.provider).toBe('github');
    expect(action?.label).toContain('EMD-123');
    expect(action?.label).toContain('Fix task context');
  });

  it('formats injected text as one line so it does not auto-submit', () => {
    const action = buildLinkedIssueContextAction(
      makeIssue({ description: 'Line one.\nLine two.\n\nLine three.' })
    );

    expect(action).not.toBeNull();
    expect(action?.text).toContain('Provider: GitHub');
    expect(action?.text).toContain('Identifier: EMD-123');
    expect(action?.text).toContain('Title: Fix task context injection behavior');
    expect(action?.text).toContain('URL: https://example.com/issues/EMD-123');
    expect(action?.text).toContain('Description: Line one. Line two. Line three.');
    expect(action?.text).toContain('Status: In Progress');
    expect(action?.text).toContain('Assignees: alice, bob');
    expect(action?.text).toContain('Project: Infra');
    expect(action?.text).not.toMatch(/\r|\n/);
  });

  it('does not truncate long descriptions when building injected text', () => {
    const longDescription = 'A'.repeat(500);
    const action = buildLinkedIssueContextAction(makeIssue({ description: longDescription }));

    expect(action).not.toBeNull();
    expect(action?.text).toContain(`Description: ${longDescription}`);
  });
});

describe('buildPromptTemplateContextActions', () => {
  it('returns empty array for no templates', () => {
    expect(buildPromptTemplateContextActions([])).toEqual([]);
  });

  it('builds actions for each template', () => {
    const templates = [
      makeTemplate({ id: 't1', name: 'Review', text: 'Review this.' }),
      makeTemplate({ id: 't2', name: 'Summarize', text: 'Summarize changes.' }),
    ];
    const actions = buildPromptTemplateContextActions(templates);

    expect(actions).toHaveLength(2);
    expect(actions[0]).toMatchObject({
      id: 'prompt-template:t1',
      kind: 'prompt-template',
      label: 'Review',
      text: 'Review this.',
    });
    expect(actions[1]).toMatchObject({
      id: 'prompt-template:t2',
      kind: 'prompt-template',
      label: 'Summarize',
      text: 'Summarize changes.',
    });
  });

  it('truncates long names', () => {
    const templates = [makeTemplate({ name: 'A'.repeat(30), text: 'text' })];
    const actions = buildPromptTemplateContextActions(templates);
    expect(actions[0]!.label.endsWith('…')).toBe(true);
  });
});

describe('buildDraftCommentsContextAction', () => {
  it('returns null when there are no comments', () => {
    expect(
      buildDraftCommentsContextAction({
        count: 0,
        formattedComments: '<user_comments>...</user_comments>',
      })
    ).toBeNull();
  });

  it('returns null when formatted comments are empty', () => {
    expect(
      buildDraftCommentsContextAction({
        count: 2,
        formattedComments: '   ',
      })
    ).toBeNull();
  });

  it('builds an action with count label', () => {
    const action = buildDraftCommentsContextAction({
      count: 2,
      formattedComments: '<user_comments>test</user_comments>',
    });
    expect(action).toEqual({
      id: 'draft-comments',
      kind: 'draft-comments',
      label: 'Comments (2)',
      text: '<user_comments>test</user_comments>',
    });
  });
});

describe('buildTaskContextActions', () => {
  it('includes linked issue, then draft comments, then prompt templates', () => {
    const templates = [makeTemplate({ id: 't1', name: 'Review', text: 'Review this worktree.' })];
    const actions = buildTaskContextActions(makeIssue(), templates, {
      count: 1,
      formattedComments: '<user_comments>test</user_comments>',
    });
    expect(actions).toHaveLength(3);
    expect(actions[0]?.id).toBe('linked-issue:github:EMD-123');
    expect(actions[1]?.id).toBe('draft-comments');
    expect(actions[2]?.id).toBe('prompt-template:t1');
  });
});
