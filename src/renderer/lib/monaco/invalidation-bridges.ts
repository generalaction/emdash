import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import { HEAD_REF, STAGED_REF } from '@shared/git';
import { events } from '@renderer/lib/ipc';
import type { MonacoModelRegistry } from './monaco-model-registry';

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
      if (e.type !== 'modify' || e.path.startsWith('.git')) continue;
      for (const uri of registry.findDiskUris({ workspaceId, filePath: e.path })) {
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
      const refKind = kind === 'remote-refs' ? 'remote' : 'local';
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
