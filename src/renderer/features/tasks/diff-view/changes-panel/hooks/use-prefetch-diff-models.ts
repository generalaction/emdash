import { useCallback, useEffect, useRef } from 'react';
import { HEAD_REF, STAGED_REF, type GitRef } from '@shared/git';
import { isBinaryForDiff } from '@renderer/lib/editor/fileKind';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';

interface PrefetchEntry {
  diskUri?: string;
  gitUris: string[];
}

/**
 * Returns a stable callback that pre-warms Monaco models on hover so that when the user
 * clicks to open a diff the models are already loaded. Models are unregistered on unmount.
 * TTL eviction (60 s after last subscriber leaves) handles any remaining cleanup.
 *
 * Pass `modifiedRef` for the 'pr' group to pre-warm the PR head SHA instead of HEAD.
 */
export function usePrefetchDiffModels(
  projectId: string,
  workspaceId: string,
  group: 'disk' | 'staged' | 'git' | 'pr',
  originalRef: GitRef,
  modifiedRef?: GitRef
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
  }, [workspaceId]);

  return useCallback(
    (filePath: string) => {
      if (prefetchedRef.current.has(filePath)) return;
      if (isBinaryForDiff(filePath)) return;
      const language = getLanguageFromPath(filePath);
      const root = `workspace:${workspaceId}`;
      const uri = buildMonacoModelPath(root, filePath);
      const entry: PrefetchEntry = { gitUris: [] };

      if (group === 'disk') {
        void modelRegistry
          .registerModel(projectId, workspaceId, root, filePath, language, 'disk')
          .catch(() => {});
        void modelRegistry
          .registerModel(projectId, workspaceId, root, filePath, language, 'git', originalRef)
          .catch(() => {});
        entry.diskUri = modelRegistry.toDiskUri(uri);
        entry.gitUris = [modelRegistry.toGitUri(uri, originalRef)];
      } else if (group === 'staged') {
        void modelRegistry
          .registerModel(projectId, workspaceId, root, filePath, language, 'git', HEAD_REF)
          .catch(() => {});
        void modelRegistry
          .registerModel(projectId, workspaceId, root, filePath, language, 'git', STAGED_REF)
          .catch(() => {});
        entry.gitUris = [
          modelRegistry.toGitUri(uri, HEAD_REF),
          modelRegistry.toGitUri(uri, STAGED_REF),
        ];
      } else {
        const effectiveModifiedRef = group === 'pr' && modifiedRef ? modifiedRef : HEAD_REF;
        void modelRegistry
          .registerModel(projectId, workspaceId, root, filePath, language, 'git', originalRef)
          .catch(() => {});
        void modelRegistry
          .registerModel(
            projectId,
            workspaceId,
            root,
            filePath,
            language,
            'git',
            effectiveModifiedRef
          )
          .catch(() => {});
        entry.gitUris = [
          modelRegistry.toGitUri(uri, originalRef),
          modelRegistry.toGitUri(uri, effectiveModifiedRef),
        ];
      }

      prefetchedRef.current.set(filePath, entry);
    },
    [projectId, workspaceId, group, originalRef, modifiedRef]
  );
}
