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
}

export const ChangesTab: React.FC<ChangesTabProps> = ({
  taskId,
  taskPath,
  fileChanges,
  onRefreshChanges,
}) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  // Auto-select the first file when fileChanges arrive and nothing is selected
  useEffect(() => {
    if (fileChanges.length > 0 && selectedFile === null) {
      setSelectedFile(fileChanges[0].path);
    }
  }, [fileChanges, selectedFile]);

  return (
    <ResizablePanelGroup direction="horizontal">
      {/* Left panel — file list + commit area */}
      <ResizablePanel defaultSize={30} minSize={20} maxSize={50}>
        <div className="flex h-full flex-col">
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
      <ResizablePanel defaultSize={70} minSize={30}>
        <DiffPanel
          taskId={taskId}
          taskPath={taskPath}
          fileChanges={fileChanges}
          selectedFile={selectedFile}
          onRefreshChanges={onRefreshChanges}
        />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
