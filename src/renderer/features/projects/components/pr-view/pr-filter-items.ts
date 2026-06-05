import type { PullRequestUser } from '@shared/pull-requests';

export type UserItem = { value: string; label: string; avatarUrl?: string };

export function toUserItem(user: PullRequestUser): UserItem {
  return {
    value: user.userId,
    label: user.displayName ?? user.userName,
    avatarUrl: user.avatarUrl ?? undefined,
  };
}
