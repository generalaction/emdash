import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { modelRegistry } from '@renderer/lib/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useTaskViewContext } from '../../task-view-context';
import { useGitViewContext } from '../state/git-view-provider';
import { useFileDiff } from '../state/use-file-diff';
import { splitPath } from '../utils';
import { PooledDiffEditor } from './pooled-diff-editor';

export function FileDiffView() {
  const { activeFile, diffStyle } = useGitViewContext();
  const { projectId, taskId } = useTaskViewContext();

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
            originalUri={(() => {
              const uri = buildMonacoModelPath(`task:${taskId}`, activeFile.path);
              return modelRegistry.hasModel(uri) ? uri : undefined;
            })()}
          />
        ) : null}
      </div>
    </div>
  );
}
