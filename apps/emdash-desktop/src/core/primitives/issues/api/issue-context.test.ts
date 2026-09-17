import { describe, expect, it } from 'vitest';
import {
  extractIssueMentionTargets,
  issueMentionToken,
  parseIssueMentionToken,
  resolveIssueMentionSource,
} from './issue-context';

describe('issue mention source identity', () => {
  it('preserves source account and URL through a durable mention token', () => {
    const source = {
      accountId: 'linear:org:user',
      url: 'https://linear.app/a/issue/ENG-1/title(with-parens)',
    };
    const token = issueMentionToken('linear', 'ENG-1', source);
    expect(token).not.toMatch(/[()]/);
    expect(parseIssueMentionToken(token)).toEqual({
      token,
      provider: 'linear',
      identifier: 'ENG-1',
      accountId: source.accountId,
      issueUrl: source.url,
    });
    expect(extractIssueMentionTargets(`@[ENG-1](${token})`)).toHaveLength(1);
  });
  it('keeps issues with equal shorthand but different accounts distinct', () => {
    const a = issueMentionToken('linear', 'ENG-1', {
      accountId: 'a',
      url: 'https://linear.app/a/issue/ENG-1',
    });
    const b = issueMentionToken('linear', 'ENG-1', {
      accountId: 'b',
      url: 'https://linear.app/b/issue/ENG-1',
    });
    expect(extractIssueMentionTargets(`@[ENG-1](${a}) @[ENG-1](${b})`)).toHaveLength(2);
  });
  it('still reads legacy tokens and rejects malformed source tokens', () => {
    expect(parseIssueMentionToken('issue:linear:ENG-1')).toEqual({
      token: 'issue:linear:ENG-1',
      provider: 'linear',
      identifier: 'ENG-1',
    });
    expect(parseIssueMentionToken('issue:v1:%broken')).toBeNull();
    expect(
      parseIssueMentionToken(
        `issue:v1:${encodeURIComponent(JSON.stringify({ provider: 'linear' }))}`
      )
    ).toBeNull();
  });
  it('only resolves a legacy mention when its original linked snapshot identifies the source', () => {
    const target = {
      token: 'issue:linear:ENG-1',
      provider: 'linear' as const,
      identifier: 'ENG-1',
    };
    expect(resolveIssueMentionSource(target)).toBeNull();
    expect(
      resolveIssueMentionSource(target, {
        provider: 'linear',
        identifier: 'ENG-1',
        title: 'A',
        url: 'https://linear.app/a/issue/ENG-1',
      })
    ).toMatchObject({ issueUrl: 'https://linear.app/a/issue/ENG-1' });
    expect(
      resolveIssueMentionSource(target, {
        provider: 'linear',
        identifier: 'ENG-2',
        title: 'Different',
        url: 'https://linear.app/a/issue/ENG-2',
      })
    ).toBeNull();
  });
});
