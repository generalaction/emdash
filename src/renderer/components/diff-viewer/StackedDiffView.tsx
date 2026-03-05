import React, { useState, useCallback } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { Checkbox } from '../ui/checkbox';
import type { FileChange } from '../../hooks/useFileChanges';
import { isBinaryFile } from '../../lib/diffUtils';
import { FileDiffView } from './FileDiffView';
import { splitPath } from './pathUtils';

interface StackedDiffViewProps {
  taskPath?: string;
  taskId?: string;
  fileChanges: FileChange[];
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => Promise<void> | void;
}

const LARGE_DIFF_LINE_THRESHOLD = 2500;
const MIN_EDITOR_HEIGHT = 100;

interface FileSectionProps {
  file: FileChange;
  taskPath?: string;
  taskId?: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => Promise<void> | void;
}

const FileSection: React.FC<FileSectionProps> = ({
  file,
  taskPath,
  taskId,
  diffStyle,
  onRefreshChanges,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [forceLoad, setForceLoad] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const binary = isBinaryFile(file.path);
  const totalDiffLines = file.additions + file.deletions;
  const isLarge = totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;

  const { filename: fileName, directory: dirPath } = splitPath(file.path);

  const toggleExpanded = useCallback(() => setExpanded((prev) => !prev), []);

  const handleStage = useCallback(
    async (checked: boolean) => {
      if (!taskPath) return;
      try {
        if (checked) {
          await window.electronAPI.stageFile({ taskPath, filePath: file.path });
        } else {
          await window.electronAPI.unstageFile({ taskPath, filePath: file.path });
        }
      } catch (err) {
        console.error('Staging failed:', err);
      }
      await onRefreshChanges?.();
    },
    [taskPath, file.path, onRefreshChanges]
  );

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;

  return (
    <div className="border-b border-border">
      <div className="flex w-full items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted/50">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={toggleExpanded}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">{fileName}</span>
          {dirPath && <span className="truncate text-muted-foreground">{dirPath}</span>}
        </button>
        <span className="shrink-0 text-xs">
          <span className="text-green-500">+{file.additions}</span>{' '}
          <span className="text-red-500">-{file.deletions}</span>
        </span>
        <Checkbox
          checked={file.isStaged}
          onCheckedChange={(checked) => {
            void handleStage(checked === true);
          }}
          onClick={(e) => e.stopPropagation()}
          className="ml-1 flex-shrink-0"
        />
      </div>

      {expanded && (
        <div style={{ height: binary || (isLarge && !forceLoad) ? 120 : editorHeight }}>
          {binary ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Binary file
            </div>
          ) : isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Large file ({totalDiffLines} diff lines). Loading may be slow.</span>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                onClick={() => setForceLoad(true)}
              >
                Load anyway
              </button>
            </div>
          ) : (
            <FileDiffView
              taskPath={taskPath}
              taskId={taskId}
              filePath={file.path}
              diffStyle={diffStyle}
              onRefreshChanges={onRefreshChanges}
              onContentHeightChange={setContentHeight}
            />
          )}
        </div>
      )}
    </div>
  );
};

export const StackedDiffView: React.FC<StackedDiffViewProps> = ({
  taskPath,
  taskId,
  fileChanges,
  diffStyle,
  onRefreshChanges,
}) => {
  if (fileChanges.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes to display
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {fileChanges.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          taskPath={taskPath}
          taskId={taskId}
          diffStyle={diffStyle}
          onRefreshChanges={onRefreshChanges}
        />
      ))}
    </div>
  );
};
