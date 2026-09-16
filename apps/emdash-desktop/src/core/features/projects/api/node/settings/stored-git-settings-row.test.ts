import { describe, expect, it } from 'vitest';
import { storedGitSettingsFromRow } from './effective-settings';

/**
 * Regression guard: the resolver reads the per-project issue-tracker pin through
 * `storedGitSettingsFromRow`, which parses via the tolerant legacy schema. If
 * `issueTrackerAccounts` is stripped or a stray key throws, per-project pins
 * silently stop working (or fall open to another workspace). See /review P1.
 */
describe('storedGitSettingsFromRow — issueTrackerAccounts', () => {
  it('preserves the issueTrackerAccounts pin through the read path', () => {
    const json = JSON.stringify({
      issueTrackerAccounts: { linear: { kind: 'account', accountId: 'linear:acme' } },
    });
    const result = storedGitSettingsFromRow(json, null);
    expect(result.issueTrackerAccounts).toEqual({
      linear: { kind: 'account', accountId: 'linear:acme' },
    });
  });

  it('preserves a { kind: "none" } disable choice', () => {
    const json = JSON.stringify({ issueTrackerAccounts: { linear: { kind: 'none' } } });
    const result = storedGitSettingsFromRow(json, null);
    expect(result.issueTrackerAccounts?.linear).toEqual({ kind: 'none' });
  });

  it('does not throw or drop the linear pin when a stray github key is present', () => {
    // A malformed/legacy row must never wipe the whole settings object, which
    // would make the resolver infer a different workspace's default (fail open).
    const json = JSON.stringify({
      issueTrackerAccounts: {
        linear: { kind: 'account', accountId: 'linear:acme' },
        github: { kind: 'none' },
      },
    });
    const result = storedGitSettingsFromRow(json, null);
    expect(result.issueTrackerAccounts?.linear).toEqual({
      kind: 'account',
      accountId: 'linear:acme',
    });
  });
});
