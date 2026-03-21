import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { PooledDiffEditor } from '@renderer/core/monaco/pooled-diff-editor';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { useGitViewContext } from '@renderer/views/tasks/diff-viewer/state/git-view-provider';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { useDiffModels } from '../use-diff-models';

export function FileDiffView() {
  const { activeFile, diffStyle } = useGitViewContext();
  const { projectId, taskId } = useTaskViewContext();

  const isBinary = activeFile ? isBinaryForDiff(activeFile.path) : false;
  const language = activeFile ? getLanguageFromPath(activeFile.path) : '';

  const { diskUri, gitUri, isLoading } = useDiffModels(
    projectId,
    taskId,
    isBinary ? null : (activeFile?.path ?? null),
    language
  );

  if (!activeFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to view changes
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
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
            modifiedDiskUri={diskUri}
            language={language}
            diffStyle={diffStyle}
          />
        )}
      </div>
    </div>
  );
}
