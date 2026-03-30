import { observer } from 'mobx-react-lite';
import { useEffect } from 'react';
import { diffEditorPool } from '@renderer/core/monaco/monaco-diff-pool';
import { useProvisionedTask, useTaskViewContext } from '@renderer/views/tasks/task-view-context';
import { DiffEditorProvider } from './diff-editor-provider';
import { DiffToolbar } from './diff-toolbar';
import { FileDiffView } from './file-diff-view';
import { StackedDiffView } from './stacked-diff-view';

export const DiffView = observer(function DiffView() {
  const { taskId } = useTaskViewContext();
  const diffView = useProvisionedTask()?.diffView;
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
      <DiffEditorProvider key={taskId}>
        <div className="min-h-0 flex-1">
          {viewMode === 'stacked' ? <StackedDiffView /> : <FileDiffView />}
        </div>
      </DiffEditorProvider>
    </div>
  );
});
