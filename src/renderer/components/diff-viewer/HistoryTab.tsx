import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Copy, Check } from 'lucide-react';
import { CommitList } from './CommitList';
import type { CommitInfo } from './CommitList';
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
  const [selectedCommit, setSelectedCommit] = useState<CommitInfo | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [diffStyle, setDiffStyle] = useState<'unified' | 'split'>(
    () => (localStorage.getItem('diffViewer:diffStyle') as 'unified' | 'split') || 'unified'
  );
  const [detailExpanded, setDetailExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleDiffStyleChange = (style: 'unified' | 'split') => {
    setDiffStyle(style);
    localStorage.setItem('diffViewer:diffStyle', style);
  };

  const handleSelectCommit = (commit: CommitInfo) => {
    if (commit.hash === selectedCommit?.hash) return;
    setSelectedCommit(commit);
    setSelectedFile(null);
    setDetailExpanded(false);
    setCopied(false);
  };

  // Compute middle and right panel sizes so all three sum to 100
  const middlePanelSize = Math.round((100 - leftPanelSize) * 0.2);
  const rightPanelSize = 100 - leftPanelSize - middlePanelSize;

  const bodyTrimmed = selectedCommit?.body?.trim() || '';
  const hasExpandableContent = bodyTrimmed.length > 0 || !!selectedCommit?.author;

  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleCopyHash = async () => {
    if (!selectedCommit) return;
    try {
      await navigator.clipboard.writeText(selectedCommit.hash);
      setCopied(true);
      clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API not available
    }
  };

  useEffect(() => {
    return () => clearTimeout(copyTimerRef.current);
  }, []);

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
              selectedCommit={selectedCommit?.hash ?? null}
              onSelectCommit={handleSelectCommit}
            />
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      {/* Middle column: Commit detail + file list */}
      <ResizablePanel defaultSize={middlePanelSize} minSize={10} maxSize={35}>
        <div className="flex h-full flex-col border-r border-border">
          {selectedCommit ? (
            <>
              {/* Commit message detail */}
              <div className="border-b border-border px-3 py-2">
                <div className="flex items-center gap-1">
                  <div className="min-w-0 flex-1 truncate text-sm font-medium leading-snug">
                    {selectedCommit.subject}
                  </div>
                  {hasExpandableContent && (
                    <button
                      className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={() => setDetailExpanded((prev) => !prev)}
                    >
                      {detailExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                </div>
                {detailExpanded && (
                  <div className="mt-1.5">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>{selectedCommit.author}</span>
                      <button
                        className="flex items-center gap-1 rounded px-1 py-0.5 font-mono hover:bg-muted hover:text-foreground"
                        onClick={() => void handleCopyHash()}
                        title="Copy commit hash"
                      >
                        {selectedCommit.hash.slice(0, 7)}
                        {copied ? (
                          <Check className="h-3 w-3 text-green-500" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                    {bodyTrimmed && (
                      <div className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-muted-foreground">
                        {bodyTrimmed}
                      </div>
                    )}
                  </div>
                )}
              </div>
              {/* File list */}
              <div className="min-h-0 flex-1 overflow-y-auto">
                <CommitFileList
                  taskPath={taskPath}
                  commitHash={selectedCommit.hash}
                  selectedFile={selectedFile}
                  onSelectFile={setSelectedFile}
                />
              </div>
            </>
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
                hideViewModeToggle
                closeButton={closeButton}
              />
              <div className="min-h-0 flex-1">
                <CommitFileDiffView
                  taskPath={taskPath}
                  commitHash={selectedCommit.hash}
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
