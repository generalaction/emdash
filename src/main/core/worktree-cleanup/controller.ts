import { createRPCController } from '@shared/ipc/rpc';
import type { ListManagedWorktreesOptions } from '@shared/worktree-cleanup';
import { worktreeCleanupService } from './service';

export const worktreeCleanupController = createRPCController({
  listManagedWorktrees: (options?: ListManagedWorktreesOptions) =>
    worktreeCleanupService.listManagedWorktrees(options),
  cleanupNow: () => worktreeCleanupService.cleanup(),
});
