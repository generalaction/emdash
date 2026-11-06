import { describe, expect, it } from 'vitest';
import { getWaitlistCardMode, releaseKey } from './waitlist-visibility';

describe('releaseKey', () => {
  it('strips prerelease and build metadata', () => {
    expect(releaseKey('1.2.10')).toBe('1.2.10');
    expect(releaseKey('1.2.10-canary.102')).toBe('1.2.10');
    expect(releaseKey('1.2.10+build.5')).toBe('1.2.10');
    expect(releaseKey('')).toBe('');
  });
});

describe('getWaitlistCardMode', () => {
  const base = {
    currentVersion: '1.2.10',
    persisted: {},
    showJoinedConfirmation: false,
  };

  it('invites when never dismissed', () => {
    expect(getWaitlistCardMode(base)).toBe('invite');
  });

  it('hides until the version is known', () => {
    expect(getWaitlistCardMode({ ...base, currentVersion: '' })).toBe('hidden');
  });

  it('stays hidden for the release it was dismissed in, including its canaries', () => {
    const persisted = { dismissedRelease: '1.2.10' };
    expect(getWaitlistCardMode({ ...base, persisted })).toBe('hidden');
    expect(getWaitlistCardMode({ ...base, persisted, currentVersion: '1.2.10-canary.102' })).toBe(
      'hidden'
    );
  });

  it('comes back after updating to a new release', () => {
    expect(
      getWaitlistCardMode({
        ...base,
        currentVersion: '1.2.11',
        persisted: { dismissedRelease: '1.2.10' },
      })
    ).toBe('invite');
  });

  it('shows the confirmation only in the session the user joined', () => {
    const persisted = { joinedEmail: 'jane@example.com' };
    expect(getWaitlistCardMode({ ...base, persisted, showJoinedConfirmation: true })).toBe(
      'joined'
    );
    expect(getWaitlistCardMode({ ...base, persisted })).toBe('hidden');
    expect(getWaitlistCardMode({ ...base, persisted, currentVersion: '1.3.0' })).toBe('hidden');
  });
});
