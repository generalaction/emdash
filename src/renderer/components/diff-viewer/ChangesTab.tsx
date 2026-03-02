import React, { useEffect, useState } from 'react';
import { FileList } from './FileList';
import { CommitArea } from './CommitArea';
import { DiffPanel } from './DiffPanel';
import type { FileChange } from '../../hooks/useFileChanges';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';

interface ChangesTabProps {
  taskId?: string;
  taskPath?: string;
  fileChanges: FileChange[];
  onRefreshChanges?: () => Promise<void> | void;
  header?: React.ReactNode;
  closeButton?: React.ReactNode;
  leftPanelSize?: number;
  onLeftPanelResize?: (size: number) => void;
  initialFile?: string | null;
}

export const ChangesTab: React.FC<ChangesTabProps> = ({
  taskId,
  taskPath,
  fileChanges,
  onRefreshChanges,
  header,
  closeButton,
  leftPanelSize = 30,
  onLeftPanelResize,
  initialFile,
}) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const initialFileConsumed = React.useRef(false);

  // Auto-select the initial file or the first file, or clear selection when files disappear
  useEffect(() => {
    if (fileChanges.length === 0) {
      setSelectedFile(null);
      return;
    }

    // If we have an initial file that hasn't been consumed yet, select it
    if (
      initialFile &&
      !initialFileConsumed.current &&
      fileChanges.some((f) => f.path === initialFile)
    ) {
      initialFileConsumed.current = true;
      setSelectedFile(initialFile);
      return;
    }

    if (selectedFile === null || !fileChanges.some((f) => f.path === selectedFile)) {
      setSelectedFile(fileChanges[0].path);
    }
  }, [fileChanges, selectedFile, initialFile]);

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => {
        if (sizes[0] !== undefined) onLeftPanelResize?.(sizes[0]);
      }}
    >
      {/* Left panel — tabs + file list + commit area */}
      <ResizablePanel defaultSize={leftPanelSize} minSize={20} maxSize={50}>
        <div className="flex h-full flex-col border-r border-border">
          {header}
          <div className="flex-1 overflow-y-auto">
            <FileList
              fileChanges={fileChanges}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
              taskPath={taskPath}
              onRefreshChanges={onRefreshChanges}
            />
          </div>
          <CommitArea
            taskPath={taskPath}
            fileChanges={fileChanges}
            onRefreshChanges={onRefreshChanges}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Right panel — diff viewer */}
      <ResizablePanel defaultSize={100 - leftPanelSize} minSize={30}>
        <DiffPanel
          taskId={taskId}
          taskPath={taskPath}
          fileChanges={fileChanges}
          selectedFile={selectedFile}
          onRefreshChanges={onRefreshChanges}
          closeButton={closeButton}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
