import { describe, expect, it } from 'vitest';
import { injectIssueFooter } from '../../main/lib/prIssueFooter';

describe('injectIssueFooter', () => {
  it('appends footer lines for linked GitHub and Linear issues', () => {
    const result = injectIssueFooter('## Changes\n- Update auth flow', {
      githubIssue: { number: 123 },
      linearIssue: { identifier: 'ABC-456' },
    });

    expect(result).toContain('## Changes');
    expect(result).toContain('<!-- emdash-issue-footer:start -->');
    expect(result).toContain('Fixes #123');
    expect(result).toContain('Fixes ABC-456');
    expect(result).toContain('<!-- emdash-issue-footer:end -->');
  });

  it('creates a footer-only body when no original body is provided', () => {
    const result = injectIssueFooter(undefined, {
      githubIssue: { number: 42 },
    });

    expect(result).toBe(
      '<!-- emdash-issue-footer:start -->\nFixes #42\n<!-- emdash-issue-footer:end -->'
    );
  });

  it('is idempotent and does not duplicate the footer block', () => {
    const metadata = { githubIssue: { number: 77 }, linearIssue: { identifier: 'TST-8' } };
    const first = injectIssueFooter('Body text', metadata);
    const second = injectIssueFooter(first, metadata);

    expect(second).toBe(first);
    expect(second?.match(/emdash-issue-footer:start/g)).toHaveLength(1);
    expect(second?.match(/Fixes #77/g)).toHaveLength(1);
    expect(second?.match(/Fixes TST-8/g)).toHaveLength(1);
  });

  it('replaces stale injected footer content', () => {
    const staleBody = [
      'Body text',
      '',
      '<!-- emdash-issue-footer:start -->',
      'Fixes #1',
      '<!-- emdash-issue-footer:end -->',
    ].join('\n');

    const result = injectIssueFooter(staleBody, {
      githubIssue: { number: 2 },
    });

    expect(result).toContain('Fixes #2');
    expect(result).not.toContain('Fixes #1');
    expect(result?.match(/emdash-issue-footer:start/g)).toHaveLength(1);
  });

  it('removes an existing injected block when no issue metadata is present', () => {
    const bodyWithFooter = [
      'Body text',
      '',
      '<!-- emdash-issue-footer:start -->',
      'Fixes #5',
      '<!-- emdash-issue-footer:end -->',
    ].join('\n');

    const result = injectIssueFooter(bodyWithFooter, null);
    expect(result).toBe('Body text');
  });

  it('returns undefined when body only contained injected footer and no issues remain', () => {
    const bodyWithFooter = [
      '<!-- emdash-issue-footer:start -->',
      'Fixes #5',
      '<!-- emdash-issue-footer:end -->',
    ].join('\n');

    const result = injectIssueFooter(bodyWithFooter, {});
    expect(result).toBeUndefined();
  });
});
