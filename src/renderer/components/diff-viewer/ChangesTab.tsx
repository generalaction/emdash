import React, { useState } from 'react';
import { FileList } from './FileList';
import { CommitArea } from './CommitArea';
import type { FileChange } from '../../hooks/useFileChanges';

interface ChangesTabProps {
  taskId?: string;
  taskPath?: string;
  fileChanges: FileChange[];
  onRefreshChanges?: () => Promise<void> | void;
}

export const ChangesTab: React.FC<ChangesTabProps> = ({
  taskId: _taskId,
  taskPath,
  fileChanges,
  onRefreshChanges,
}) => {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);

  return (
    <div className="flex h-full">
      {/* Left panel — file list + commit area */}
      <div className="flex w-[280px] flex-shrink-0 flex-col border-r border-border">
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

      {/* Right panel — diff content placeholder */}
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {selectedFile ? `Diff for ${selectedFile}` : 'Select a file to view changes'}
      </div>
    </div>
  );
};
