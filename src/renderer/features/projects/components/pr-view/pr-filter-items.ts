import type { PullRequestUser } from '@shared/pull-requests';

export type UserItem = { value: string; label: string; avatarUrl?: string };

export function toUserItem(user: PullRequestUser): UserItem {
  return {
    value: user.userId,
    label: user.displayName ?? user.userName,
    avatarUrl: user.avatarUrl ?? undefined,
  };
}

export function usersWithLoginFirst(
  users: ReadonlyArray<PullRequestUser>,
  login?: string | null
): PullRequestUser[] {
  if (!login) return [...users];

  const normalizedLogin = login.toLowerCase();
  const currentUserIndex = users.findIndex(
    (user) => user.userName.toLowerCase() === normalizedLogin
  );
  if (currentUserIndex === -1) return [...users];

  const currentUser = users[currentUserIndex];
  return [currentUser, ...users.slice(0, currentUserIndex), ...users.slice(currentUserIndex + 1)];
}
