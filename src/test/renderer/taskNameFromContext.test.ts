import { describe, expect, it } from 'vitest';
import { generateTaskNameFromContext } from '../../renderer/lib/branchNameGenerator';

describe('generateTaskNameFromContext', () => {
  it('returns null when no context is available', () => {
    expect(generateTaskNameFromContext({})).toBeNull();
    expect(generateTaskNameFromContext({ initialPrompt: null })).toBeNull();
  });

  it('generates name from initial prompt', () => {
    const result = generateTaskNameFromContext({
      initialPrompt: 'Fix the broken authentication on the login page',
    });
    expect(result).toBeTruthy();
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('prioritizes linked issue over initial prompt', () => {
    const fromPrompt = generateTaskNameFromContext({
      initialPrompt: 'Do something generic and vague here',
    });
    const fromIssue = generateTaskNameFromContext({
      initialPrompt: 'Do something generic and vague here',
      linearIssue: {
        id: 'LIN-123',
        identifier: 'LIN-123',
        title: 'Fix authentication redirect loop',
        url: 'https://linear.app/issue/LIN-123',
      } as any,
    });

    expect(fromPrompt).toBeTruthy();
    expect(fromIssue).toBeTruthy();
    // Issue-derived name should differ from prompt-derived name
    expect(fromIssue).not.toEqual(fromPrompt);
  });

  it('generates name from GitHub issue', () => {
    const result = generateTaskNameFromContext({
      githubIssue: {
        number: 42,
        title: 'Mobile layout breaks on small screens',
        url: 'https://github.com/org/repo/issues/42',
      } as any,
    });
    expect(result).toBeTruthy();
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('generates name from Jira issue', () => {
    const result = generateTaskNameFromContext({
      jiraIssue: {
        key: 'PROJ-456',
        summary: 'Add dark mode support to settings page',
      } as any,
    });
    expect(result).toBeTruthy();
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('returns null for very short prompts', () => {
    expect(generateTaskNameFromContext({ initialPrompt: 'fix' })).toBeNull();
    expect(generateTaskNameFromContext({ initialPrompt: 'ok' })).toBeNull();
  });

  it('returns null for slash commands', () => {
    expect(generateTaskNameFromContext({ initialPrompt: '/help' })).toBeNull();
  });
});
