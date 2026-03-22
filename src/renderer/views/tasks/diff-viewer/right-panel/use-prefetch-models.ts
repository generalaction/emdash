import { useCallback, useEffect, useRef } from 'react';
import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';

interface PrefetchEntry {
  diskUri?: string;
  gitUris: string[];
}

/**
 * Returns a stable callback that pre-warms Monaco models on hover so that when the user
 * clicks to open a diff the models are already loaded. Models are unregistered on unmount.
 * TTL eviction (60 s after last subscriber leaves) handles any remaining cleanup.
 */
export function usePrefetchModels(
  projectId: string,
  taskId: string,
  type: 'disk' | 'staged' | 'git',
  originalRef: string
) {
  const prefetchedRef = useRef(new Map<string, PrefetchEntry>());

  useEffect(() => {
    const prefetched = prefetchedRef.current;
    return () => {
      for (const entry of prefetched.values()) {
        if (entry.diskUri) modelRegistry.unregisterModel(entry.diskUri);
        for (const gitUri of entry.gitUris) modelRegistry.unregisterModel(gitUri);
      }
    };
  }, [taskId]);

  return useCallback(
    (filePath: string) => {
      if (prefetchedRef.current.has(filePath)) return;
      if (isBinaryForDiff(filePath)) return;
      const language = getLanguageFromPath(filePath);
      const root = `task:${taskId}`;
      const uri = buildMonacoModelPath(root, filePath);
      const entry: PrefetchEntry = { gitUris: [] };

      if (type === 'disk') {
        void modelRegistry
          .registerModel(projectId, taskId, root, filePath, language, 'disk')
          .catch(() => {});
        void modelRegistry
          .registerModel(projectId, taskId, root, filePath, language, 'git', originalRef)
          .catch(() => {});
        entry.diskUri = modelRegistry.toDiskUri(uri);
        entry.gitUris = [modelRegistry.toGitUri(uri, originalRef)];
      } else if (type === 'staged') {
        void modelRegistry
          .registerModel(projectId, taskId, root, filePath, language, 'git', 'HEAD')
          .catch(() => {});
        void modelRegistry
          .registerModel(projectId, taskId, root, filePath, language, 'git', 'staged')
          .catch(() => {});
        entry.gitUris = [
          modelRegistry.toGitUri(uri, 'HEAD'),
          modelRegistry.toGitUri(uri, 'staged'),
        ];
      } else {
        void modelRegistry
          .registerModel(projectId, taskId, root, filePath, language, 'git', originalRef)
          .catch(() => {});
        void modelRegistry
          .registerModel(projectId, taskId, root, filePath, language, 'git', 'HEAD')
          .catch(() => {});
        entry.gitUris = [
          modelRegistry.toGitUri(uri, originalRef),
          modelRegistry.toGitUri(uri, 'HEAD'),
        ];
      }

      prefetchedRef.current.set(filePath, entry);
    },
    [projectId, taskId, type, originalRef]
  );
}
