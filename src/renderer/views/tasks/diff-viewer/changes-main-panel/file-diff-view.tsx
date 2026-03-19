import { useEffect } from 'react';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { useModelStatus } from '@renderer/core/monaco/use-model';
import { isBinaryForDiff } from '@renderer/lib/fileKind';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useTaskViewContext } from '../../task-view-context';
import { useGitViewContext } from '../state/git-view-provider';
import { splitPath } from '../utils';
import { PooledDiffEditor } from './pooled-diff-editor';

export function FileDiffView() {
  const { activeFile, diffStyle } = useGitViewContext();
  const { projectId, taskId } = useTaskViewContext();

  const isBinary = activeFile ? isBinaryForDiff(activeFile.path) : false;

  // Compute typed URIs (empty strings when no file / binary — harmless for hooks below).
  const uri = activeFile ? buildMonacoModelPath(`task:${taskId}`, activeFile.path) : '';
  const diskUri = uri ? modelRegistry.toDiskUri(uri) : '';
  const gitUri = uri ? modelRegistry.toGitUri(uri, 'HEAD') : '';
  const language = activeFile ? getLanguageFromPath(activeFile.path) : '';

  // Register disk + git models on active file change.
  // FS watching is driven entirely by useModelStatus subscriptions below
  // (subscriber count 0→1 activates watching; 1→0 stops it).
  useEffect(() => {
    if (!activeFile || isBinary) return;
    const filePath = activeFile.path;

    void modelRegistry.registerModel(
      projectId,
      taskId,
      `task:${taskId}`,
      filePath,
      language,
      'disk'
    );
    void modelRegistry.registerModel(
      projectId,
      taskId,
      `task:${taskId}`,
      filePath,
      language,
      'git'
    );

    return () => {
      const u = buildMonacoModelPath(`task:${taskId}`, filePath);
      modelRegistry.unregisterModel(modelRegistry.toDiskUri(u));
      modelRegistry.unregisterModel(modelRegistry.toGitUri(u, 'HEAD'));
    };
  }, [activeFile?.path, projectId, taskId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Subscribe to model status — drives FS watching while this view is mounted.
  const diskStatus = useModelStatus(diskUri);
  const gitStatus = useModelStatus(gitUri);
  const isLoading = diskStatus === 'loading' || gitStatus === 'loading';

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to view changes
      </div>
    );
  }

  const { filename, directory } = splitPath(activeFile.path);

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
        {isBinary ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Binary file — no diff available
          </div>
        ) : isLoading ? (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : (
          <PooledDiffEditor
            originalUri={gitUri}
            modifiedUri={uri}
            language={language}
            diffStyle={diffStyle}
          />
        )}
      </div>
    </div>
  );
}
