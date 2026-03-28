import { observer } from 'mobx-react-lite';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { PooledDiffEditor } from '@renderer/core/monaco/pooled-diff-editor';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { useDiffModels } from '../use-diff-models';

export const FileDiffView = observer(function FileDiffView() {
  const { projectId, taskId } = useTaskViewContext();
  const diffView = asProvisioned(getTaskStore(projectId, taskId))?.diffView;
  const activeFile = diffView?.activeFile ?? null;
  const diffStyle = diffView?.diffStyle ?? 'unified';

  const isBinary = activeFile ? isBinaryForDiff(activeFile.path) : false;
  const language = activeFile ? getLanguageFromPath(activeFile.path) : '';

  const { originalUri, modifiedUri, isLoading } = useDiffModels(
    projectId,
    taskId,
    isBinary ? null : (activeFile?.path ?? null),
    language,
    activeFile?.type ?? 'disk',
    activeFile?.originalRef ?? 'HEAD'
  );

  if (!activeFile) {
    return (
      <EmptyState
        label="Select a file to view changes"
        description="Select a file to view changes"
      />
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
            originalUri={originalUri}
            modifiedUri={modifiedUri}
            language={language}
            diffStyle={diffStyle}
          />
        )}
      </div>
    </div>
  );
});
