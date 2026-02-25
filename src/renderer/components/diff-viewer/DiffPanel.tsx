import React, { useState } from 'react';
import type { FileChange } from '../../hooks/useFileChanges';
import { DiffToolbar } from './DiffToolbar';
import { FileDiffView } from './FileDiffView';
import { StackedDiffView } from './StackedDiffView';

interface DiffPanelProps {
  taskId?: string;
  taskPath?: string;
  fileChanges: FileChange[];
  selectedFile: string | null;
  onRefreshChanges?: () => Promise<void> | void;
}

export const DiffPanel: React.FC<DiffPanelProps> = ({
  taskId,
  taskPath,
  fileChanges,
  selectedFile,
  onRefreshChanges,
}) => {
  const [viewMode, setViewMode] = useState<'stacked' | 'file'>('stacked');
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');

  return (
    <div className="flex h-full flex-col">
      <DiffToolbar
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        diffStyle={diffStyle}
        onDiffStyleChange={setDiffStyle}
        taskPath={taskPath}
      />
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
