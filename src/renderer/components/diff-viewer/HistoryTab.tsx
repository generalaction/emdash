import React, { useState } from 'react';
import { CommitList } from './CommitList';
import { CommitFileList } from './CommitFileList';
import { CommitFileDiffView } from './CommitFileDiffView';
import { DiffToolbar } from './DiffToolbar';

interface HistoryTabProps {
  taskPath?: string;
}

export const HistoryTab: React.FC<HistoryTabProps> = ({ taskPath }) => {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>('unified');

  const handleSelectCommit = (hash: string) => {
    setSelectedCommit(hash);
    setSelectedFile(null);
  };

  return (
    <div className="flex h-full">
      {/* Left column: Commit list */}
      <div className="w-[280px] flex-shrink-0 overflow-y-auto border-r border-border">
        <CommitList
          taskPath={taskPath}
          selectedCommit={selectedCommit}
          onSelectCommit={handleSelectCommit}
        />
      </div>

      {/* Middle column: File list for selected commit */}
      {selectedCommit && (
        <div className="w-[280px] flex-shrink-0 overflow-y-auto border-r border-border">
          <CommitFileList
            taskPath={taskPath}
            commitHash={selectedCommit}
            selectedFile={selectedFile}
            onSelectFile={setSelectedFile}
          />
        </div>
      )}

      {/* Right column: Diff view */}
      <div className="flex min-w-0 flex-1 flex-col">
        {selectedCommit && selectedFile ? (
          <>
            <DiffToolbar
              viewMode="file"
              onViewModeChange={() => {}}
              diffStyle={diffStyle}
              onDiffStyleChange={setDiffStyle}
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
    </div>
  );
};
