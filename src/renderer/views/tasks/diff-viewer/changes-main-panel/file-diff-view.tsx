import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { useTaskViewContext } from '../../task-view-context';
import { DiffEditorStyles, useMonacoDiffTheme } from '../monaco-diff-view';
import { useGitViewContext } from '../state/git-view-provider';
import { useFileDiff } from '../state/use-file-diff';
import { splitPath } from '../utils';
import { MonacoDiff } from './monaco-diff';

export function FileDiffView() {
  const { activeFile, diffStyle } = useGitViewContext();
  const { projectId, taskId } = useTaskViewContext();
  const { isDark } = useMonacoDiffTheme();

  const {
    data: diff,
    isLoading,
    isError,
  } = useFileDiff(
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
      <DiffEditorStyles isDark={isDark} />

      {/* Breadcrumb header */}
      <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-3 text-xs">
        <span className="font-medium truncate">{filename}</span>
        {directory && <span className="text-muted-foreground truncate">{directory}</span>}
        <span className="ml-auto shrink-0 rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
          {activeFile.isStaged ? 'Staged' : 'Unstaged'}
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {isLoading ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Loading diff…
          </div>
        ) : isError ? (
          <div className="flex h-full items-center justify-center text-sm text-destructive">
            Failed to load diff
          </div>
        ) : diff?.isBinary ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Binary file — no diff available
          </div>
        ) : diff ? (
          <MonacoDiff
            original={diff.originalContent ?? ''}
            modified={diff.modifiedContent ?? ''}
            language={language}
            diffStyle={diffStyle}
          />
        ) : null}
      </div>
    </div>
  );
}
