import { defineEvent } from '@shared/ipc/events';

export const managedWorktreeSizeUpdatedChannel = defineEvent<{
  workspaceId: string;
  sizeBytes: number;
}>('worktree:size-updated');

export const managedWorktreeRefreshCompleteChannel = defineEvent<{
  totalSizeBytes: number;
}>('worktree:refresh-complete');
