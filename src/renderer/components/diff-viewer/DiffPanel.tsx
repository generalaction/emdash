import React, { useEffect, useRef, useState } from 'react';
import type { FileChange } from '../../hooks/useFileChanges';
import { DiffToolbar } from './DiffToolbar';
import { FileDiffView } from './FileDiffView';
import { splitPath } from './pathUtils';
import { StackedDiffView } from './StackedDiffView';

interface DiffPanelProps {
  taskId?: string;
  taskPath?: string;
  fileChanges: FileChange[];
  selectedFile: string | null;
  onRefreshChanges?: () => Promise<void> | void;
  closeButton?: React.ReactNode;
}

export const DiffPanel: React.FC<DiffPanelProps> = ({
  taskId,
  taskPath,
  fileChanges,
  selectedFile,
  onRefreshChanges,
  closeButton,
}) => {
  const [viewMode, setViewMode] = useState<'stacked' | 'file'>(
    () => (localStorage.getItem('diffViewer:viewMode') as 'stacked' | 'file') || 'stacked'
  );
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>(
    () => (localStorage.getItem('diffViewer:diffStyle') as 'unified' | 'split') || 'unified'
  );

  const handleViewModeChange = (mode: 'stacked' | 'file') => {
    setViewMode(mode);
    localStorage.setItem('diffViewer:viewMode', mode);
  };

  const handleDiffStyleChange = (style: 'unified' | 'split') => {
    setDiffStyle(style);
    localStorage.setItem('diffViewer:diffStyle', style);
  };

  // When user clicks a file in the sidebar while in stacked mode, switch to file view
  const prevSelectedFileRef = useRef(selectedFile);
  useEffect(() => {
    if (selectedFile && selectedFile !== prevSelectedFileRef.current && viewMode === 'stacked') {
      handleViewModeChange('file');
    }
    prevSelectedFileRef.current = selectedFile;
  }, [selectedFile, viewMode]);

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        diffStyle={diffStyle}
        onDiffStyleChange={handleDiffStyleChange}
        closeButton={closeButton}
      />
      {viewMode === 'file' &&
        selectedFile &&
        (() => {
          const fileChange = fileChanges.find((f) => f.path === selectedFile);
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
      <div className="flex-1 overflow-hidden">
        {viewMode === 'stacked' ? (
          <StackedDiffView
            taskPath={taskPath}
            taskId={taskId}
            fileChanges={fileChanges}
            diffStyle={diffStyle}
            onRefreshChanges={onRefreshChanges}
          />
        ) : selectedFile ? (
          <FileDiffView
            taskPath={taskPath}
            taskId={taskId}
            filePath={selectedFile}
            diffStyle={diffStyle}
            onRefreshChanges={onRefreshChanges}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a file to view changes
          </div>
        )}
      </div>
    </div>
  );
};
