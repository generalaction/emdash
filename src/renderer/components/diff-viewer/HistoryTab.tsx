import React, { useState } from 'react';
import { CommitList } from './CommitList';
import { CommitFileList } from './CommitFileList';
import { CommitFileDiffView } from './CommitFileDiffView';
import { DiffToolbar } from './DiffToolbar';
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable';

interface HistoryTabProps {
  taskPath?: string;
  header?: React.ReactNode;
  closeButton?: React.ReactNode;
  leftPanelSize?: number;
  onLeftPanelResize?: (size: number) => void;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({
  taskPath,
  header,
  closeButton,
  leftPanelSize = 20,
  onLeftPanelResize,
}) => {
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

  // Compute middle and right panel sizes so all three sum to 100
  const middlePanelSize = Math.round((100 - leftPanelSize) * 0.2);
  const rightPanelSize = 100 - leftPanelSize - middlePanelSize;

  return (
    <ResizablePanelGroup
      direction="horizontal"
      onLayout={(sizes) => {
        if (sizes[0] !== undefined) onLeftPanelResize?.(sizes[0]);
      }}
    >
      {/* Left column: Tabs + Commit list */}
      <ResizablePanel defaultSize={leftPanelSize} minSize={12} maxSize={40}>
        <div className="flex h-full flex-col border-r border-border">
          {header}
          <div className="flex-1 overflow-y-auto">
            <CommitList
              taskPath={taskPath}
              selectedCommit={selectedCommit}
              onSelectCommit={handleSelectCommit}
            />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Middle column: File list for selected commit */}
      <ResizablePanel defaultSize={middlePanelSize} minSize={10} maxSize={35}>
        <div className="h-full overflow-y-auto border-r border-border">
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
      <ResizablePanel defaultSize={rightPanelSize} minSize={30}>
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
                closeButton={closeButton}
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
            <div className="flex h-full flex-col">
              <div className="flex items-center justify-end border-b border-border px-2 py-1">
                {closeButton}
              </div>
              <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                {selectedCommit
                  ? 'Select a file to view changes'
                  : 'Select a commit to view changes'}
              </div>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
};
