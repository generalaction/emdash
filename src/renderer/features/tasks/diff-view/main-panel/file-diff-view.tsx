import { observer } from 'mobx-react-lite';
import { useProvisionedTask } from '@renderer/features/tasks/task-view-context';
import { isBinaryForDiff } from '@renderer/lib/editor/fileKind';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { useDiffEditorContext } from './diff-editor-provider';

export const FileDiffView = observer(function FileDiffView() {
  const { setDiffEditorHost } = useDiffEditorContext();
  const diffView = useProvisionedTask().taskView.diffView;
  const activeFile = diffView.activeFile;

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
