import { useEffect } from 'react';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { useModelStatus } from '@renderer/core/monaco/use-model';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';

export interface DiffModels {
  diskUri: string;
  gitUri: string;
  isLoading: boolean;
}

/**
 * Registers disk and git (HEAD) Monaco models for a single file and subscribes
 * to their load status. Handles registration, FS-watch activation (via
 * useModelStatus), and cleanup on unmount or file change.
 *
 * Returns empty URIs and `isLoading: false` when `filePath` is null/empty so
 * callers can safely skip rendering without extra guards.
 */
export function useDiffModels(
  projectId: string,
  taskId: string,
  filePath: string | null,
  language: string
): DiffModels {
  const uri = filePath ? buildMonacoModelPath(`task:${taskId}`, filePath) : '';
  const diskUri = uri ? modelRegistry.toDiskUri(uri) : '';
  const gitUri = uri ? modelRegistry.toGitUri(uri, 'HEAD') : '';

  useEffect(() => {
    if (!filePath) return;
    const path = filePath;

    modelRegistry.registerModel(projectId, taskId, `task:${taskId}`, path, language, 'disk');
    modelRegistry.registerModel(projectId, taskId, `task:${taskId}`, path, language, 'git');

    return () => {
      const u = buildMonacoModelPath(`task:${taskId}`, path);
      modelRegistry.unregisterModel(modelRegistry.toDiskUri(u));
      modelRegistry.unregisterModel(modelRegistry.toGitUri(u, 'HEAD'));
    };
  }, [filePath, projectId, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  const diskStatus = useModelStatus(diskUri);
  const gitStatus = useModelStatus(gitUri);
  const isLoading = diskStatus === 'loading' || gitStatus === 'loading';

  return { diskUri, gitUri, isLoading };
}
