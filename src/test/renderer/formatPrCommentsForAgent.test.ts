import { describe, it, expect } from 'vitest';
import { formatPrCommentsForAgent } from '../../renderer/lib/formatPrCommentsForAgent';
import type { PrComment } from '../../renderer/lib/prCommentsStatus';

function makeComment(overrides: Partial<PrComment> = {}): PrComment {
  return {
    id: '1',
    author: { login: 'alice' },
    body: 'Please fix this',
    createdAt: '2026-01-01T00:00:00Z',
    type: 'comment',
    ...overrides,
  };
}

describe('formatPrCommentsForAgent', () => {
  it('returns empty string for no comments', () => {
    expect(formatPrCommentsForAgent([])).toBe('');
  });

  it('formats a single comment', () => {
    const result = formatPrCommentsForAgent([makeComment()]);
    expect(result).toBe(
      '\n<pr_comments>\n  <comment author="alice">Please fix this</comment>\n</pr_comments>'
    );
  });

  it('formats multiple comments', () => {
    const result = formatPrCommentsForAgent([
      makeComment({ id: '1', author: { login: 'alice' }, body: 'Fix A' }),
      makeComment({ id: '2', author: { login: 'bob' }, body: 'Fix B' }),
    ]);
    expect(result).toContain('<comment author="alice">Fix A</comment>');
    expect(result).toContain('<comment author="bob">Fix B</comment>');
    expect(result).toMatch(/^\n<pr_comments>\n/);
  });

  it('includes review state for reviews', () => {
    const result = formatPrCommentsForAgent([
      makeComment({ type: 'review', reviewState: 'APPROVED', body: 'LGTM' }),
    ]);
    expect(result).toContain('state="approved"');
  });

  it('includes changes_requested state', () => {
    const result = formatPrCommentsForAgent([
      makeComment({ type: 'review', reviewState: 'CHANGES_REQUESTED', body: 'Needs work' }),
    ]);
    expect(result).toContain('state="changes_requested"');
  });

  it('omits state attribute for plain comments even with reviewState', () => {
    const result = formatPrCommentsForAgent([
      makeComment({ type: 'comment', reviewState: 'APPROVED', body: 'Nice' }),
    ]);
    expect(result).not.toContain('state=');
  });

  it('omits state attribute for reviews without a recognized state', () => {
    const result = formatPrCommentsForAgent([
      makeComment({ type: 'review', reviewState: 'COMMENTED', body: 'FYI' }),
    ]);
    expect(result).not.toContain('state=');
  });

  it('escapes XML-sensitive characters in body and author', () => {
    const result = formatPrCommentsForAgent([
      makeComment({
        author: { login: 'user"name' },
        body: 'Use </comment> & <script>alert("xss")</script>',
      }),
    ]);
    expect(result).toContain('author="user&quot;name"');
    expect(result).toContain('&lt;/comment&gt;');
    expect(result).toContain('&amp;');
    expect(result).toContain('&lt;script&gt;');
    expect(result).not.toContain('<script>');
  });
});
