import { useCallback, useEffect, useRef } from 'react';
import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';

/**
 * Returns a stable callback that pre-warms Monaco models on hover so that when the user
 * clicks to open a diff the models are already loaded. Models are unregistered on unmount.
 * TTL eviction (60 s after last subscriber leaves) handles any remaining cleanup.
 */
export function usePrefetchModels(projectId: string, taskId: string) {
  const prefetchedRef = useRef(new Set<string>());

  useEffect(() => {
    const prefetched = prefetchedRef.current;
    return () => {
      for (const filePath of prefetched) {
        const uri = buildMonacoModelPath(`task:${taskId}`, filePath);
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(uri));
        modelRegistry.unregisterModel(modelRegistry.toGitUri(uri, 'HEAD'));
      }
    };
  }, [taskId]);

  return useCallback(
    (filePath: string) => {
      if (prefetchedRef.current.has(filePath)) return;
      if (isBinaryForDiff(filePath)) return;
      prefetchedRef.current.add(filePath);
      const language = getLanguageFromPath(filePath);
      void modelRegistry
        .registerModel(projectId, taskId, `task:${taskId}`, filePath, language, 'disk')
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, taskId, `task:${taskId}`, filePath, language, 'git')
        .catch(() => {});
    },
    [projectId, taskId]
  );
}
