import { describe, expect, it } from 'vitest';
import {
  assertRemoteHostMatchesInstance,
  hasKnownNetworkErrorCode,
  normalizeHostedInstanceUrl,
} from './hosted-instance';

describe('normalizeHostedInstanceUrl', () => {
  it('normalizes valid host URLs', () => {
    expect(normalizeHostedInstanceUrl('https://gitlab.example.com/')).toBe(
      'https://gitlab.example.com'
    );
    expect(normalizeHostedInstanceUrl('https://gitlab.example.com/foo/')).toBe(
      'https://gitlab.example.com/foo'
    );
  });

  it('rejects invalid URLs', () => {
    expect(normalizeHostedInstanceUrl('')).toBeNull();
    expect(normalizeHostedInstanceUrl('ssh://gitlab.example.com')).toBeNull();
    expect(normalizeHostedInstanceUrl('https://gitlab.example.com?a=1')).toBeNull();
  });
});

describe('hasKnownNetworkErrorCode', () => {
  it('matches known network error codes', () => {
    expect(hasKnownNetworkErrorCode({ code: 'ENOTFOUND' })).toBe(true);
    expect(hasKnownNetworkErrorCode({ code: 'EAI_AGAIN' })).toBe(true);
    expect(hasKnownNetworkErrorCode({ code: 'EOTHER' })).toBe(false);
    expect(hasKnownNetworkErrorCode({})).toBe(false);
  });
});

describe('assertRemoteHostMatchesInstance', () => {
  it('allows matching hosts', () => {
    expect(() =>
      assertRemoteHostMatchesInstance('gitlab.example.com', 'https://gitlab.example.com', 'GitLab')
    ).not.toThrow();
  });

  it('throws for mismatched hosts', () => {
    expect(() =>
      assertRemoteHostMatchesInstance('other.example.com', 'https://gitlab.example.com', 'GitLab')
    ).toThrow('does not match configured GitLab instance');
  });
});
