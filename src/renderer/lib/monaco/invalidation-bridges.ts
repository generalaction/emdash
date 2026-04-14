import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { gitRefChangedChannel, gitWorkspaceChangedChannel } from '@shared/events/gitEvents';
import { events } from '@renderer/lib/ipc';
import type { MonacoModelRegistry } from './monaco-model-registry';

/**
 * Heuristic: a git:// URI contains a remote-tracking ref if the ref segment
 * contains a slash (e.g. origin/main). Commit hashes and local refs like HEAD
 * or 'staged' do not contain slashes.
 *
 * URI format: git://<root>/<encodedRef>/<filePath>
 * The ref is percent-encoded, so slashes in remote refs become %2F.
 */
function isRemoteTrackingUri(uri: string): boolean {
  const match = /^git:\/\/[^/]+\/([^/]+)\//.exec(uri);
  if (!match) return false;
  const encodedRef = match[1]!;
  return encodedRef.includes('%2F');
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
      if (e.type !== 'modify' || e.path.startsWith('.git')) continue;
      for (const uri of registry.findDiskUris({ workspaceId, filePath: e.path })) {
        void registry.invalidateModel(uri);
      }
    }
  });

  // Workspace index/HEAD changes → invalidate staged or HEAD git:// models.
  const unsubWorkspace = events.on(gitWorkspaceChangedChannel, ({ workspaceId, kind }) => {
    const ref = kind === 'index' ? 'staged' : 'HEAD';
    for (const uri of registry.findGitUris({ workspaceId, ref })) {
      void registry.invalidateModel(uri);
    }
  });

  // Remote-ref changes → invalidate remote-tracking git:// models for the project.
  const unsubRefs = events.on(gitRefChangedChannel, ({ projectId, kind }) => {
    if (kind !== 'remote-refs') return;
    for (const uri of registry.findGitUris({ projectId }).filter(isRemoteTrackingUri)) {
      void registry.invalidateModel(uri);
    }
  });

  return () => {
    unsubFs();
    unsubWorkspace();
    unsubRefs();
  };
}
