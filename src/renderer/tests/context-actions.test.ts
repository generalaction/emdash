import { describe, expect, it } from 'vitest';
import type { Issue } from '@shared/tasks';
import {
  buildLinkedIssueContextAction,
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

describe('buildLinkedIssueContextAction', () => {
  it('returns null when no issue is linked', () => {
    expect(buildLinkedIssueContextAction(undefined)).toBeNull();
  });

  it('builds an inject action with provider metadata and compact label', () => {
    const action = buildLinkedIssueContextAction(makeIssue());

    expect(action).not.toBeNull();
    expect(action?.id).toBe('linked-issue:github:EMD-123');
    expect(action?.behavior).toBe('inject');
    expect(action?.provider).toBe('github');
    expect(action?.label).toContain('EMD-123');
    expect(action?.label).toContain('Fix task context injection behavior');
  });

  it('formats injected text as one line so it does not auto-submit', () => {
    const action = buildLinkedIssueContextAction(
      makeIssue({ description: 'Line one.\nLine two.\n\nLine three.' })
    );

    expect(action).not.toBeNull();
    expect(action?.text).toContain('Provider: GitHub');
    expect(action?.text).toContain('Provider key: github');
    expect(action?.text).toContain('Identifier: EMD-123');
    expect(action?.text).toContain('Title: Fix task context injection behavior');
    expect(action?.text).toContain('URL: https://example.com/issues/EMD-123');
    expect(action?.text).toContain('Description: Line one. Line two. Line three.');
    expect(action?.text).toContain('Status: In Progress');
    expect(action?.text).toContain('Assignees: alice, bob');
    expect(action?.text).toContain('Project: Infra');
    expect(action?.text).toContain('Updated at: 2026-04-15T11:27:38.662Z');
    expect(action?.text).toContain('Fetched at: 2026-04-15T15:49:46.788Z');
    expect(action?.text).not.toMatch(/\r|\n/);
  });

  it('does not truncate long descriptions when building injected text', () => {
    const longDescription = 'A'.repeat(500);
    const action = buildLinkedIssueContextAction(makeIssue({ description: longDescription }));

    expect(action).not.toBeNull();
    expect(action?.text).toContain(`Description: ${longDescription}`);
  });
});

describe('buildTaskContextActions', () => {
  it('includes linked issue context as the first context action', () => {
    const actions = buildTaskContextActions(makeIssue());
    expect(actions).toHaveLength(1);
    expect(actions[0]?.id).toBe('linked-issue:github:EMD-123');
  });
});
