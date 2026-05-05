import { describe, expect, it } from 'vitest';
import { parseCursor } from './cursor';

describe('parseCursor', () => {
  it('migrates legacy issue-only initialization without initializing PRs', () => {
    const cursor = parseCursor(
      JSON.stringify({
        initialized: true,
        seenIssueIds: ['https://github.com/acme/repo/issues/1'],
      })
    );

    expect(cursor).toMatchObject({
      initializedIssues: true,
      initializedPrs: false,
      seenIssueIds: ['https://github.com/acme/repo/issues/1'],
    });
    expect(cursor?.initialized).toBeUndefined();
  });

  it('migrates legacy PR-only initialization without initializing issues', () => {
    const cursor = parseCursor(
      JSON.stringify({
        initialized: true,
        seenPrs: { 'https://github.com/acme/repo/pull/1': 'open' },
      })
    );

    expect(cursor).toMatchObject({
      initializedIssues: false,
      initializedPrs: true,
      seenPrs: { 'https://github.com/acme/repo/pull/1': 'open' },
    });
    expect(cursor?.initialized).toBeUndefined();
  });
});
