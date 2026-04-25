import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import type { FileWatchEvent } from '@shared/fs';
import { HEAD_REF, STAGED_REF } from '@shared/git';
import { events } from '@renderer/lib/ipc';
import type { MonacoModelRegistry } from './monaco-model-registry';

/** Disk models for paths affected by a watch event (atomic saves often use create/delete, not modify). */
function diskUrisForFsWatchEvent(
  registry: MonacoModelRegistry,
  workspaceId: string,
  e: FileWatchEvent
): string[] {
  if (e.path.startsWith('.git')) return [];
  if (e.oldPath?.startsWith('.git')) return [];

  if (e.type === 'rename' && e.oldPath) {
    return [
      ...registry.findDiskUris({ workspaceId, filePath: e.path }),
      ...registry.findDiskUris({ workspaceId, filePath: e.oldPath }),
    ];
  }

  if (e.entryType !== 'file') return [];
  if (e.type === 'modify' || e.type === 'create' || e.type === 'delete') {
    return registry.findDiskUris({ workspaceId, filePath: e.path });
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
  const unsubFs = events.on(fsWatchEventChannel, ({ workspaceId, events: fsEvents }) => {
    for (const e of fsEvents) {
      const skippedGit = e.path.startsWith('.git') || e.oldPath?.startsWith('.git');
      const uris = skippedGit ? [] : diskUrisForFsWatchEvent(registry, workspaceId, e);
      if (skippedGit) continue;
      for (const uri of uris) {
        void registry.invalidateModel(uri);
      }
    }
  });

  // Workspace index/HEAD changes → invalidate staged or HEAD git:// models.
  const unsubWorkspace = events.on(gitWorkspaceChangedChannel, ({ workspaceId, kind }) => {
    const ref = kind === 'index' ? STAGED_REF : HEAD_REF;
    for (const uri of registry.findGitUris({ workspaceId, ref })) {
      void registry.invalidateModel(uri);
    }
  });

  // Local/remote ref changes → invalidate matching git:// models (exact ref when known).
  const unsubRefs = events.on(gitRefChangedChannel, ({ projectId, kind, changedRefs }) => {
    if (kind === 'config') return;
    if (changedRefs) {
      for (const ref of changedRefs) {
        for (const uri of registry.findGitUris({ projectId, ref })) {
          void registry.invalidateModel(uri);
        }
      }
    } else {
      const refKind = 'branch'; // Both local and remote branches now share kind:'branch'
      for (const uri of registry.findGitUris({ projectId, refKind })) {
        void registry.invalidateModel(uri);
      }
    }
  });

  return () => {
    unsubFs();
    unsubWorkspace();
    unsubRefs();
  };
}
