import { describe, it, expect } from 'vitest';
import { generateTaskNameFromContext } from '../../renderer/lib/branchNameGenerator';

describe('generateTaskNameFromContext', () => {
  it('generates name from initial prompt', () => {
    const result = generateTaskNameFromContext({
      initialPrompt: 'Fix the login page crash on mobile Safari',
    });
    expect(result).toBeTruthy();
    expect(result!.length).toBeLessThanOrEqual(64);
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('generates name from linear issue title', () => {
    const result = generateTaskNameFromContext({
      linearIssue: { title: 'Auth token refresh fails' },
    });
    expect(result).toBeTruthy();
  });

  it('uses linear issue description for richer name generation', () => {
    const result = generateTaskNameFromContext({
      linearIssue: {
        title: 'Auth token refresh fails',
        description:
          'The refresh token is not being rotated after session timeout causing 401 errors',
      },
    });
    expect(result).toBeTruthy();
    expect(result).toMatch(/^[a-z0-9-]+$/);
  });

  it('generates name from github issue title and body', () => {
    const result = generateTaskNameFromContext({
      githubIssue: {
        title: 'Fix memory leak in PTY manager',
        body: 'The PTY instances are not being disposed when terminal tabs are closed',
      },
    });
    expect(result).toBeTruthy();
  });

  it('generates name from jira issue summary and description', () => {
    const result = generateTaskNameFromContext({
      jiraIssue: {
        summary: 'Update authentication flow',
        description: 'Migrate from session-based auth to JWT tokens for the API layer',
      },
    });
    expect(result).toBeTruthy();
  });

  it('works with issue title only when description is missing', () => {
    const result = generateTaskNameFromContext({
      githubIssue: { title: 'Fix memory leak in PTY manager' },
    });
    expect(result).toBeTruthy();
  });

  it('prefers linked issue over initial prompt', () => {
    const result = generateTaskNameFromContext({
      initialPrompt: 'Do the thing',
      linearIssue: { title: 'Specific issue title' },
    });
    expect(result).toBeTruthy();
  });

  it('returns null when no context is available', () => {
    const result = generateTaskNameFromContext({});
    expect(result).toBeNull();
  });
});
