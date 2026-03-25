import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { diffEditorPool } from '@renderer/core/monaco/monaco-diff-pool';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { getTaskStore, provisionedTask } from '@renderer/views/tasks/task-view-state';
import { DiffToolbar } from './diff-toolbar';
import { FileDiffView } from './file-diff-view';
import { StackedDiffView } from './stacked-diff-view';

export const DiffView = observer(function DiffView() {
  const { projectId, taskId } = useTaskViewContext();
  const diffView = provisionedTask(getTaskStore(projectId, taskId))?.diffView;
  const viewMode = diffView?.viewMode ?? 'stacked';
  const diffStyle = diffView?.diffStyle ?? 'unified';
  const activeFile = diffView?.activeFile ?? null;

  useEffect(() => {
    diffEditorPool.init().catch((err: unknown) => console.warn('[monaco-pool] init failed:', err));
  }, []);

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        diffSource={activeFile?.type}
        filePath={activeFile?.path}
        viewMode={viewMode}
        onViewModeChange={(mode) => diffView?.setViewMode(mode)}
        diffStyle={diffStyle}
        onDiffStyleChange={(style) => diffView?.setDiffStyle(style)}
      />
      <div className="min-h-0 flex-1">
        {viewMode === 'stacked' ? <StackedDiffView /> : <FileDiffView />}
      </div>
    </div>
  );
});
