import React, { useState } from 'react';
import { CommitList } from './CommitList';
import { CommitFileList } from './CommitFileList';
import { CommitFileDiffView } from './CommitFileDiffView';
import { DiffToolbar } from './DiffToolbar';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';

interface HistoryTabProps {
  taskPath?: string;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ taskPath }) => {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>(
    () => (localStorage.getItem('diffViewer:diffStyle') as 'unified' | 'split') || 'unified'
  );

  const handleDiffStyleChange = (style: 'unified' | 'split') => {
    setDiffStyle(style);
    localStorage.setItem('diffViewer:diffStyle', style);
  };

  const handleSelectCommit = (hash: string) => {
    setSelectedCommit(hash);
    setSelectedFile(null);
  };

  return (
    <ResizablePanelGroup direction="horizontal">
      {/* Left column: Commit list */}
      <ResizablePanel defaultSize={20} minSize={12} maxSize={40}>
        <div className="h-full overflow-y-auto">
          <CommitList
            taskPath={taskPath}
            selectedCommit={selectedCommit}
            onSelectCommit={handleSelectCommit}
          />
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Middle column: File list for selected commit */}
      <ResizablePanel defaultSize={15} minSize={10} maxSize={35}>
        <div className="h-full overflow-y-auto">
          {selectedCommit ? (
            <CommitFileList
              taskPath={taskPath}
              commitHash={selectedCommit}
              selectedFile={selectedFile}
              onSelectFile={setSelectedFile}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Select a commit
            </div>
          )}
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Right column: Diff view */}
      <ResizablePanel defaultSize={65} minSize={30}>
        <div className="flex h-full flex-col">
          {selectedCommit && selectedFile ? (
            <>
              <DiffToolbar
                viewMode="file"
                onViewModeChange={() => {}}
                diffStyle={diffStyle}
                onDiffStyleChange={handleDiffStyleChange}
                taskPath={taskPath}
                hideViewModeToggle
                hidePushButton
              />
              <div className="min-h-0 flex-1">
                <CommitFileDiffView
                  taskPath={taskPath}
                  commitHash={selectedCommit}
                  filePath={selectedFile}
                  diffStyle={diffStyle}
                />
              </div>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {selectedCommit ? 'Select a file to view changes' : 'Select a commit to view changes'}
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
