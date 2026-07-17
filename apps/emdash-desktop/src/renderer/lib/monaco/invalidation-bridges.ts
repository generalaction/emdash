import type { FileChange } from '@emdash/core/files';
import { events } from '@renderer/lib/ipc';
import { fileChangesChannel } from '@shared/core/fs/fsEvents';
import { gitRepoUpdateChannel, gitWorktreeUpdateChannel } from '@shared/core/git/events';
import { HEAD_REF, STAGED_REF } from '@shared/core/git/types';
import type { MonacoModelRegistry } from './monaco-model-registry';

/** Disk models for paths affected by a watch event (atomic saves often use create/delete, not modify). */
function diskUrisForFileChange(
  registry: MonacoModelRegistry,
  workspaceId: string,
  change: FileChange
): string[] {
  if (change.path.split(/[\\/]/).includes('.git')) return [];

  if (change.entryType !== 'directory') {
    return registry.findDiskUris({ workspaceId, filePath: change.path });
  }
  return [];
}

/**
 * Wire all three invalidation bridges for the given registry. Returns a
 * teardown function that removes all event subscriptions.
 *
 * Call once in `bootstrap()` after Monaco pool initialization.
 */
export function wireModelRegistryInvalidation(registry: MonacoModelRegistry): () => void {
  // Disk file modifications → invalidate matching disk:// models.
  const unsubFs = events.on(fileChangesChannel, ({ workspaceId, update }) => {
    if (update.kind === 'resync') {
      for (const uri of registry.findDiskUris({ workspaceId })) {
        void registry.invalidateModel(uri);
      }
      return;
    }

    for (const change of update.changes) {
      const uris = diskUrisForFileChange(registry, workspaceId, change);
      for (const uri of uris) {
        void registry.invalidateModel(uri);
      }
    }
  });

  // Workspace index/HEAD changes → invalidate staged or HEAD git:// models.
  const unsubWorkspace = events.on(gitWorktreeUpdateChannel, ({ workspaceId, update }) => {
    const ref = update.kind === 'status' ? STAGED_REF : HEAD_REF;
    for (const uri of registry.findGitUris({ workspaceId, ref })) {
      void registry.invalidateModel(uri);
    }
  });

  const unsubRefs = events.on(gitRepoUpdateChannel, ({ projectId, update }) => {
    if (update.kind !== 'refs') return;
    const refKind = 'branch';
    for (const uri of registry.findGitUris({ projectId, refKind })) {
      void registry.invalidateModel(uri);
    }
  });

  return () => {
    unsubFs();
    unsubWorkspace();
    unsubRefs();
  };
}
