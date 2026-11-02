import { describe, expect, it } from 'vitest';
import {
  checkRemoteHostMatchesInstance,
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

describe('checkRemoteHostMatchesInstance', () => {
  it('allows matching hosts', () => {
    expect(
      checkRemoteHostMatchesInstance('gitlab.example.com', 'https://gitlab.example.com', 'GitLab')
    ).toEqual({ success: true, data: undefined });
  });

  it('returns an unsupported_host error for mismatched hosts', () => {
    expect(
      checkRemoteHostMatchesInstance('other.example.com', 'https://gitlab.example.com', 'GitLab')
    ).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "other.example.com" does not match configured GitLab instance "gitlab.example.com".',
      },
    });
  });

  it('returns an invalid_input error for an invalid instance URL', () => {
    expect(checkRemoteHostMatchesInstance('gitlab.example.com', 'not a url', 'GitLab')).toEqual({
      success: false,
      error: {
        type: 'invalid_input',
        message: 'A valid GitLab instance URL is required.',
      },
    });
  });

  it('allows a remote whose non-default port matches the instance port (#3395)', () => {
    expect(
      checkRemoteHostMatchesInstance('192.0.2.10:3100', 'http://192.0.2.10:3100', 'Forgejo')
    ).toEqual({ success: true, data: undefined });
  });

  it('rejects a remote whose non-default port differs from the instance port', () => {
    expect(
      checkRemoteHostMatchesInstance('192.0.2.10:3101', 'http://192.0.2.10:3100', 'Forgejo')
    ).toEqual({
      success: false,
      error: {
        type: 'unsupported_host',
        message:
          'Git remote host "192.0.2.10:3101" does not match configured Forgejo instance "192.0.2.10:3100".',
      },
    });
  });

  it('rejects a remote with an explicit port when the instance uses the default port', () => {
    const result = checkRemoteHostMatchesInstance(
      'gitlab.example.com:8443',
      'https://gitlab.example.com',
      'GitLab'
    );
    expect(result.success).toBe(false);
  });

  it('allows a portless (scp/ssh) remote against an instance with an explicit port', () => {
    expect(
      checkRemoteHostMatchesInstance('192.0.2.10', 'http://192.0.2.10:3100', 'Forgejo')
    ).toEqual({ success: true, data: undefined });
  });

  it('matches IPv6 hosts with ports', () => {
    expect(
      checkRemoteHostMatchesInstance('[2001:db8::1]:3100', 'http://[2001:db8::1]:3100', 'Forgejo')
    ).toEqual({ success: true, data: undefined });
  });
});
