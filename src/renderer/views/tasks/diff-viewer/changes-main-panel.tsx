import { useEffect, useRef } from 'react';
import { DiffToolbar } from '@renderer/components/diff-viewer/DiffToolbar';
import { useDiffViewContext } from './diff-view-provider';
import { FileDiffEditor } from './file-diff-editor';
import { StackedDiffPanel } from './stacked-diff-panel';
import { splitPath } from './utils';

export function ChangesMainPanel() {
  const {
    projectId,
    taskId,
    viewMode,
    setViewMode,
    diffStyle,
    setDiffStyle,
    selectedFile,
    fileChanges,
    refreshChanges,
  } = useDiffViewContext();

  const prevSelectedFileRef = useRef(selectedFile);
  useEffect(() => {
    if (selectedFile && selectedFile !== prevSelectedFileRef.current && viewMode === 'stacked') {
      setViewMode('file');
    }
    prevSelectedFileRef.current = selectedFile;
  }, [selectedFile, viewMode, setViewMode]);

  const fileChange = fileChanges.find((f) => f.path === selectedFile);

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
      />
      {viewMode === 'file' &&
        selectedFile &&
        (() => {
          const { filename, directory } = splitPath(selectedFile);
          return (
            <div className="flex h-9 items-center gap-2 border-b border-border bg-muted/30 px-3 text-xs">
              <span className="truncate font-medium">{filename}</span>
              {directory && <span className="truncate text-muted-foreground">{directory}</span>}
              {fileChange && (
                <span className="ml-auto shrink-0">
                  <span className="text-green-500">+{fileChange.additions}</span>{' '}
                  <span className="text-red-500">-{fileChange.deletions}</span>
                </span>
              )}
            </div>
          );
        })()}
      <div className="min-h-0 flex-1 overflow-hidden">
        {viewMode === 'stacked' ? (
          <StackedDiffPanel />
        ) : selectedFile ? (
          <FileDiffEditor
            projectId={projectId}
            taskId={taskId}
            filePath={selectedFile}
            diffStyle={diffStyle}
            onRefreshChanges={refreshChanges}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
}
