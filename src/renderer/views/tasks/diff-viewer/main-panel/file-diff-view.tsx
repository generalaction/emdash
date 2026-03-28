import { observer } from 'mobx-react-lite';
import { EmptyState } from '@renderer/components/ui/empty-state';
import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { useDiffEditorContext } from './diff-editor-provider';

export const FileDiffView = observer(function FileDiffView() {
  const { projectId, taskId } = useTaskViewContext();
  const { setDiffEditorHost } = useDiffEditorContext();
  const diffView = asProvisioned(getTaskStore(projectId, taskId))?.diffView;
  const activeFile = diffView?.activeFile ?? null;

  const isBinary = activeFile ? isBinaryForDiff(activeFile.path) : false;
  const showEditor = activeFile !== null && !isBinary;

  return (
    <div className="flex h-full flex-col">
      <div className="relative min-h-0 flex-1">
        {/* Stable editor host — always in DOM, shown/hidden via CSS. Never re-parented. */}
        <div
          ref={setDiffEditorHost}
          className="absolute inset-0"
          style={{ display: showEditor ? 'block' : 'none' }}
        />
        {!activeFile && (
          <EmptyState
            label="Select a file to view changes"
            description="Select a file to view changes"
          />
        )}
        {isBinary && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Binary file — no diff available
          </div>
        )}
      </div>
    </div>
  );
});
