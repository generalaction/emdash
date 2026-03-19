import { useEffect, useState } from 'react';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useTaskViewContext } from '../../task-view-context';
import { useGitViewContext } from '../state/git-view-provider';
import { useFileDiff } from '../state/use-file-diff';
import { splitPath } from '../utils';
import { PooledDiffEditor } from './pooled-diff-editor';

export function FileDiffView() {
  const { activeFile, diffStyle } = useGitViewContext();
  const { projectId, taskId } = useTaskViewContext();

  // registryUri is undefined while disk+gitBase models are being registered,
  // then set to the buffer URI once both are ready. PooledDiffEditor uses live
  // registry models when registryUri is defined; falls back to RPC strings while loading.
  const [registryUri, setRegistryUri] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!activeFile) {
      setRegistryUri(undefined);
      return;
    }

    const filePath = activeFile.path;
    const language = getLanguageFromPath(filePath);
    const uri = buildMonacoModelPath(`task:${taskId}`, filePath);
    let cancelled = false;

    async function register() {
      await modelRegistry.registerModel(
        projectId,
        taskId,
        `task:${taskId}`,
        filePath,
        language,
        'disk'
      );
      await modelRegistry.registerModel(
        projectId,
        taskId,
        `task:${taskId}`,
        filePath,
        language,
        'gitBase'
      );
      if (!cancelled) setRegistryUri(uri);
    }

    void register();

    return () => {
      cancelled = true;
      setRegistryUri(undefined);
      modelRegistry.unregisterModel(uri, 'disk');
      modelRegistry.unregisterModel(uri, 'gitBase');
    };
  }, [activeFile?.path, projectId, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep useFileDiff for binary/error metadata and as content fallback while models load.
  const { data: diff, isError } = useFileDiff(
    projectId,
    taskId,
    activeFile?.path ?? '',
    activeFile?.isStaged ?? false,
    !!activeFile
  );

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to view changes
      </div>
    );
  }

  const { filename, directory } = splitPath(activeFile.path);
  const language = getLanguageFromPath(activeFile.path);

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumb header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 text-xs">
        <span className="font-medium truncate">{filename}</span>
        {directory && <span className="text-muted-foreground truncate">{directory}</span>}
        <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {activeFile.isStaged ? 'Staged' : 'Unstaged'}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {isError ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Failed to load diff
          </div>
        ) : diff?.isBinary ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Binary file — no diff available
          </div>
        ) : diff ? (
          <PooledDiffEditor
            original={diff.originalContent ?? ''}
            modified={diff.modifiedContent ?? ''}
            language={language}
            diffStyle={diffStyle}
            registryUri={registryUri}
          />
        ) : null}
      </div>
    </div>
  );
}
