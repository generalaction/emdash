import { describe, expect, it } from 'vitest';
import type { PullRequestUser } from '@shared/pull-requests';
import { usersWithLoginFirst } from './pr-filter-items';

function user(userName: string): PullRequestUser {
  return {
    userId: `id-${userName}`,
    userName,
    displayName: userName,
    avatarUrl: null,
    url: null,
    userUpdatedAt: null,
    userCreatedAt: null,
  };
}

describe('usersWithLoginFirst', () => {
  it('moves the current GitHub user to the front', () => {
    const users = [user('anna'), user('dominik'), user('zoe')];

    expect(usersWithLoginFirst(users, 'dominik').map((item) => item.userName)).toEqual([
      'dominik',
      'anna',
      'zoe',
    ]);
  });

  it('preserves order when the current GitHub user is unavailable', () => {
    const users = [user('anna'), user('zoe')];

    expect(usersWithLoginFirst(users, 'dominik').map((item) => item.userName)).toEqual([
      'anna',
      'zoe',
    ]);
  });

  it('preserves order when no GitHub login is available', () => {
    const users = [user('anna'), user('zoe')];

    expect(usersWithLoginFirst(users, null).map((item) => item.userName)).toEqual(['anna', 'zoe']);
    expect(usersWithLoginFirst(users, undefined).map((item) => item.userName)).toEqual([
      'anna',
      'zoe',
    ]);
  });

  it('preserves order when the current GitHub user is already first', () => {
    const users = [user('dominik'), user('anna'), user('zoe')];

    expect(usersWithLoginFirst(users, 'dominik').map((item) => item.userName)).toEqual([
      'dominik',
      'anna',
      'zoe',
    ]);
  });
});
