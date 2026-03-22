import { useEffect } from 'react';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { useModelStatus } from '@renderer/core/monaco/use-model';

export interface DiffModels {
  originalUri: string;
  modifiedUri: string;
  isLoading: boolean;
}

/**
 * Registers the correct pair of Monaco models for a diff and subscribes to their
 * load status. Model types depend on the diff context:
 *
 *   'disk'   — original = git at originalRef (e.g. HEAD); modified = disk (live working tree)
 *   'staged' — original = git://HEAD; modified = git://'staged' (index content)
 *   'git'    — original = git at originalRef (e.g. origin/main); modified = git://HEAD
 *
 * Returns empty URIs and `isLoading: false` when `filePath` is null/empty.
 */
export function useDiffModels(
  projectId: string,
  taskId: string,
  filePath: string | null,
  language: string,
  type: 'disk' | 'staged' | 'git',
  originalRef: string
): DiffModels {
  const uri = filePath ? buildMonacoModelPath(`task:${taskId}`, filePath) : '';

  const originalUri = uri
    ? modelRegistry.toGitUri(uri, type === 'staged' ? 'HEAD' : originalRef)
    : '';
  const modifiedUri = uri
    ? type === 'disk'
      ? modelRegistry.toDiskUri(uri)
      : modelRegistry.toGitUri(uri, type === 'staged' ? 'staged' : 'HEAD')
    : '';

  useEffect(() => {
    if (!filePath) return;
    const path = filePath;
    const root = `task:${taskId}`;

    if (type === 'disk') {
      void modelRegistry.registerModel(projectId, taskId, root, path, language, 'disk');
      void modelRegistry.registerModel(projectId, taskId, root, path, language, 'git', originalRef);
    } else if (type === 'staged') {
      void modelRegistry.registerModel(projectId, taskId, root, path, language, 'git', 'HEAD');
      void modelRegistry.registerModel(projectId, taskId, root, path, language, 'git', 'staged');
    } else {
      // 'git': both sides are git refs
      void modelRegistry.registerModel(projectId, taskId, root, path, language, 'git', originalRef);
      void modelRegistry.registerModel(projectId, taskId, root, path, language, 'git', 'HEAD');
    }

    return () => {
      const u = buildMonacoModelPath(root, path);
      if (type === 'disk') {
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(u));
        modelRegistry.unregisterModel(modelRegistry.toGitUri(u, originalRef));
      } else if (type === 'staged') {
        modelRegistry.unregisterModel(modelRegistry.toGitUri(u, 'HEAD'));
        modelRegistry.unregisterModel(modelRegistry.toGitUri(u, 'staged'));
      } else {
        modelRegistry.unregisterModel(modelRegistry.toGitUri(u, originalRef));
        modelRegistry.unregisterModel(modelRegistry.toGitUri(u, 'HEAD'));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePath, projectId, taskId, type, originalRef]);

  const originalStatus = useModelStatus(originalUri);
  const modifiedStatus = useModelStatus(modifiedUri);
  const isLoading = originalStatus === 'loading' || modifiedStatus === 'loading';

  return { originalUri, modifiedUri, isLoading };
}
