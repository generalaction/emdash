import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown } from 'lucide-react';
import { List } from 'react-window';
import type { RowComponentProps } from 'react-window';
import { Checkbox } from '../ui/checkbox';
import type { FileChange } from '../../hooks/useFileChanges';
import { formatDiffCount, getTotalDiffLines } from '../../lib/gitChangePresentation';
import { FileDiffView } from './FileDiffView';
import { splitPath } from './pathUtils';

interface StackedDiffViewProps {
  taskPath?: string;
  taskId?: string;
  fileChanges: FileChange[];
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => Promise<void> | void;
  baseRef?: string;
}

const LARGE_DIFF_LINE_THRESHOLD = 1200;
const LARGE_DIFF_PLACEHOLDER_HEIGHT = 120;
const MIN_EDITOR_HEIGHT = 100;
const ROW_HEADER_HEIGHT = 37;
const DEFAULT_COLLAPSED_FILE_COUNT = 40;
const VIRTUALIZED_FILE_COUNT = 120;
const VIRTUAL_OVERSCAN_COUNT = 8;

interface FileSectionProps {
  file: FileChange;
  expanded: boolean;
  forceLoad: boolean;
  contentHeight: number | null;
  onToggleExpanded: (filePath: string) => void;
  onForceLoad: (filePath: string) => void;
  onContentHeightChange: (filePath: string, height: number) => void;
  taskPath?: string;
  taskId?: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => Promise<void> | void;
  baseRef?: string;
}

const FileSection: React.FC<FileSectionProps> = ({
  file,
  expanded,
  forceLoad,
  contentHeight,
  onToggleExpanded,
  onForceLoad,
  onContentHeightChange,
  taskPath,
  taskId,
  diffStyle,
  onRefreshChanges,
  baseRef,
}) => {
  const totalDiffLines = getTotalDiffLines(file.additions, file.deletions);
  const isLarge = totalDiffLines !== null && totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;

  const { filename: fileName, directory: dirPath } = splitPath(file.path);

  const toggleExpanded = useCallback(
    () => onToggleExpanded(file.path),
    [file.path, onToggleExpanded]
  );

  const handleStage = useCallback(
    async (checked: boolean) => {
      if (!taskPath) return;
      try {
        await window.electronAPI.updateIndex({
          taskPath,
          action: checked ? 'stage' : 'unstage',
          scope: 'paths',
          filePaths: [file.path],
        });
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
          <span className="text-green-500">+{formatDiffCount(file.additions)}</span>{' '}
          <span className="text-red-500">-{formatDiffCount(file.deletions)}</span>
        </span>
        {!baseRef && (
          <Checkbox
            checked={file.isStaged}
            onCheckedChange={(checked) => {
              void handleStage(checked === true);
            }}
            onClick={(e) => e.stopPropagation()}
            className="ml-1 flex-shrink-0"
          />
        )}
      </div>

      {expanded && (
        <div style={{ height: isLarge && !forceLoad ? 120 : editorHeight }}>
          {isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>
                Large file ({totalDiffLines ?? 'unknown'} diff lines). Loading may be slow.
              </span>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                onClick={() => onForceLoad(file.path)}
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
              onContentHeightChange={(height) => onContentHeightChange(file.path, height)}
              baseRef={baseRef}
            />
          )}
        </div>
      )}
    </div>
  );
};

function rowHeightForFile(args: {
  file: FileChange;
  expanded: boolean;
  forceLoad: boolean;
  contentHeight: number | null;
}): number {
  const { file, expanded, forceLoad, contentHeight } = args;
  if (!expanded) return ROW_HEADER_HEIGHT;

  const totalDiffLines = getTotalDiffLines(file.additions, file.deletions);
  const isLarge = totalDiffLines !== null && totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;
  if (isLarge && !forceLoad) {
    return ROW_HEADER_HEIGHT + LARGE_DIFF_PLACEHOLDER_HEIGHT;
  }

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;
  return ROW_HEADER_HEIGHT + editorHeight;
}

type VirtualRowProps = {
  files: FileChange[];
  expandedPaths: Set<string>;
  forceLoadedPaths: Set<string>;
  contentHeights: Record<string, number>;
  onToggleExpanded: (filePath: string) => void;
  onForceLoad: (filePath: string) => void;
  onContentHeightChange: (filePath: string, height: number) => void;
  taskPath?: string;
  taskId?: string;
  diffStyle: 'unified' | 'split';
  onRefreshChanges?: () => Promise<void> | void;
  baseRef?: string;
};

function VirtualFileRow({
  index,
  style,
  files,
  expandedPaths,
  forceLoadedPaths,
  contentHeights,
  onToggleExpanded,
  onForceLoad,
  onContentHeightChange,
  taskPath,
  taskId,
  diffStyle,
  onRefreshChanges,
  baseRef,
}: RowComponentProps<VirtualRowProps>): React.JSX.Element | null {
  const file = files[index];
  if (!file) return null;

  return (
    <div style={style}>
      <FileSection
        file={file}
        expanded={expandedPaths.has(file.path)}
        forceLoad={forceLoadedPaths.has(file.path)}
        contentHeight={contentHeights[file.path] ?? null}
        onToggleExpanded={onToggleExpanded}
        onForceLoad={onForceLoad}
        onContentHeightChange={onContentHeightChange}
        taskPath={taskPath}
        taskId={taskId}
        diffStyle={diffStyle}
        onRefreshChanges={onRefreshChanges}
        baseRef={baseRef}
      />
    </div>
  );
}

export const StackedDiffView: React.FC<StackedDiffViewProps> = ({
  taskPath,
  taskId,
  fileChanges,
  diffStyle,
  onRefreshChanges,
  baseRef,
}) => {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [forceLoadedPaths, setForceLoadedPaths] = useState<Set<string>>(new Set());
  const [contentHeights, setContentHeights] = useState<Record<string, number>>({});
  const initializedRef = useRef(false);
  const contextKey = `${taskPath ?? ''}|${taskId ?? ''}|${baseRef ?? ''}`;

  useEffect(() => {
    initializedRef.current = false;
    setExpandedPaths(new Set());
    setForceLoadedPaths(new Set());
    setContentHeights({});
  }, [contextKey]);

  useEffect(() => {
    if (fileChanges.length === 0) {
      initializedRef.current = false;
      setExpandedPaths(new Set());
      setForceLoadedPaths(new Set());
      setContentHeights({});
      return;
    }

    const pathSet = new Set(fileChanges.map((file) => file.path));
    const shouldDefaultCollapsed = fileChanges.length >= DEFAULT_COLLAPSED_FILE_COUNT;

    setExpandedPaths((prev) => {
      const next = new Set([...prev].filter((path) => pathSet.has(path)));
      if (!initializedRef.current) {
        if (!shouldDefaultCollapsed) {
          fileChanges.forEach((file) => next.add(file.path));
        }
        initializedRef.current = true;
      }
      return next;
    });

    setForceLoadedPaths((prev) => new Set([...prev].filter((path) => pathSet.has(path))));
    setContentHeights((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([path]) => pathSet.has(path)))
    );
  }, [fileChanges]);

  const onToggleExpanded = useCallback((filePath: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }, []);

  const onForceLoad = useCallback((filePath: string) => {
    setForceLoadedPaths((prev) => {
      if (prev.has(filePath)) return prev;
      const next = new Set(prev);
      next.add(filePath);
      return next;
    });
  }, []);

  const onContentHeightChange = useCallback((filePath: string, height: number) => {
    setContentHeights((prev) => {
      if (prev[filePath] === height) return prev;
      return { ...prev, [filePath]: height };
    });
  }, []);

  const useVirtualizedList = fileChanges.length >= VIRTUALIZED_FILE_COUNT;

  const getRowHeight = useCallback(
    (file: FileChange): number => {
      return rowHeightForFile({
        file,
        expanded: expandedPaths.has(file.path),
        forceLoad: forceLoadedPaths.has(file.path),
        contentHeight: contentHeights[file.path] ?? null,
      });
    },
    [contentHeights, expandedPaths, forceLoadedPaths]
  );

  const virtualRowProps = useMemo<VirtualRowProps>(
    () => ({
      files: fileChanges,
      expandedPaths,
      forceLoadedPaths,
      contentHeights,
      onToggleExpanded,
      onForceLoad,
      onContentHeightChange,
      taskPath,
      taskId,
      diffStyle,
      onRefreshChanges,
      baseRef,
    }),
    [
      fileChanges,
      expandedPaths,
      forceLoadedPaths,
      contentHeights,
      onToggleExpanded,
      onForceLoad,
      onContentHeightChange,
      taskPath,
      taskId,
      diffStyle,
      onRefreshChanges,
      baseRef,
    ]
  );

  if (fileChanges.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes to display
      </div>
    );
  }

  if (useVirtualizedList) {
    return (
      <div className="h-full">
        <List
          rowCount={fileChanges.length}
          rowHeight={(index, props: VirtualRowProps) => getRowHeight(props.files[index])}
          rowComponent={VirtualFileRow}
          rowProps={virtualRowProps}
          overscanCount={VIRTUAL_OVERSCAN_COUNT}
          style={{ height: '100%', width: '100%' }}
        />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {fileChanges.map((file) => (
        <FileSection
          key={file.path}
          file={file}
          expanded={expandedPaths.has(file.path)}
          forceLoad={forceLoadedPaths.has(file.path)}
          contentHeight={contentHeights[file.path] ?? null}
          onToggleExpanded={onToggleExpanded}
          onForceLoad={onForceLoad}
          onContentHeightChange={onContentHeightChange}
          taskPath={taskPath}
          taskId={taskId}
          diffStyle={diffStyle}
          onRefreshChanges={onRefreshChanges}
          baseRef={baseRef}
        />
      ))}
    </div>
  );
};
