import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitChange } from '@shared/git';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { useTaskViewContext } from '../../task-view-context';
import { DiffEditorStyles, useMonacoDiffTheme } from '../monaco-diff-view';
import { useGitChangesContext } from '../state/git-changes-provider';
import { useGitViewContext } from '../state/git-view-provider';
import { useFileDiff } from '../state/use-file-diff';
import { MonacoDiff } from './monaco-diff';

const LARGE_DIFF_LINE_THRESHOLD = 2500;

// ---------------------------------------------------------------------------
// StackedDiffView — single panel, switches based on activeFile.isStaged
// ---------------------------------------------------------------------------

export function StackedDiffView() {
  const { isDark } = useMonacoDiffTheme();
  const { activeFile } = useGitViewContext();
  const isStaged = activeFile?.isStaged ?? false;

  return (
    <>
      <DiffEditorStyles isDark={isDark} />
      <StackedDiffPanel isStaged={isStaged} />
    </>
  );
}

// ---------------------------------------------------------------------------
// StackedDiffPanel — virtualized scroll container for one group
// ---------------------------------------------------------------------------

interface StackedDiffPanelProps {
  isStaged: boolean;
}

function StackedDiffPanel({ isStaged }: StackedDiffPanelProps) {
  const { projectId, taskId } = useTaskViewContext();
  const { stagedFileChanges, unstagedFileChanges } = useGitChangesContext();
  const { activeFile, setActiveFile, viewMode, diffStyle } = useGitViewContext();

  const files = isStaged ? stagedFileChanges : unstagedFileChanges;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const suppressObserver = useRef(false);

  // Stable ref so onChange always reads current values without stale closures
  const scrollSyncRef = useRef({ files, isStaged, setActiveFile, suppress: suppressObserver });
  scrollSyncRef.current = { files, isStaged, setActiveFile, suppress: suppressObserver };

  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: useCallback(
      (i: number) => {
        const file = files[i];
        if (!file) return 200;
        // 44px header + ~18px per diff line, capped at 50 lines
        return 44 + Math.min(file.additions + file.deletions, 50) * 18;
      },
      [files]
    ),
    overscan: 1,
    onChange: (instance) => {
      const { files: f, isStaged: s, setActiveFile: setFile, suppress } = scrollSyncRef.current;
      if (suppress.current) return;
      const startIndex = instance.range?.startIndex;
      if (startIndex == null) return;
      const file = f[startIndex];
      if (file) setFile({ path: file.path, isStaged: s });
    },
  });

  // Click → scroll: when activeFile changes or mode switches back to stacked
  useEffect(() => {
    if (viewMode !== 'stacked') return;
    if (activeFile?.isStaged !== isStaged) return;
    const index = files.findIndex((f) => f.path === activeFile?.path);
    if (index < 0) return;

    // Already at this position — onChange just set activeFile from a scroll event;
    // returning early breaks the feedback loop that would otherwise suppress onChange for 700ms.
    // Use range.startIndex (not getVirtualItems()[0]) to avoid the overscan offset.
    const currentTopIndex = virtualizer.range?.startIndex;
    if (currentTopIndex === index) return;

    suppressObserver.current = true;
    virtualizer.scrollToIndex(index, { align: 'start', behavior: 'smooth' });
    const timer = setTimeout(() => {
      suppressObserver.current = false;
    }, 700);
    return () => clearTimeout(timer);
  }, [activeFile?.path, activeFile?.isStaged, viewMode, files, isStaged, virtualizer]);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No {isStaged ? 'staged changes' : 'changes'}
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const file = files[virtualItem.index]!;
          return (
            <div
              key={virtualItem.key}
              data-index={virtualItem.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
            >
              <StackedFileSection
                file={file}
                projectId={projectId}
                taskId={taskId}
                isStaged={isStaged}
                diffStyle={diffStyle}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// StackedFileSection — collapsible section for a single file
// ---------------------------------------------------------------------------

interface StackedFileSectionProps {
  file: GitChange;
  projectId: string;
  taskId: string;
  isStaged: boolean;
  diffStyle: 'unified' | 'split';
}

const MIN_EDITOR_HEIGHT = 100;

function StackedFileSection({
  file,
  projectId,
  taskId,
  isStaged,
  diffStyle,
}: StackedFileSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [forceLoad, setForceLoad] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const { data: diff, isLoading } = useFileDiff(projectId, taskId, file.path, isStaged, expanded);

  const parts = file.path.split('/');
  const fileName = parts.pop() || file.path;
  const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';
  const language = getLanguageFromPath(file.path);

  const totalDiffLines = file.additions + file.deletions;
  const isLarge = totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;
  const isBinary = diff?.isBinary ?? false;

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;

  return (
    <div className="border-b border-border">
      <div className="flex w-full items-center gap-1.5 px-3 py-2 text-sm hover:bg-muted/50">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span className="font-medium text-foreground">{fileName}</span>
          {dirPath && <span className="truncate text-muted-foreground">{dirPath}</span>}
        </button>
        <span className="shrink-0 text-xs">
          <span className="text-green-500">+{file.additions}</span>{' '}
          <span className="text-red-500">-{file.deletions}</span>
        </span>
      </div>

      {expanded && (
        <div style={{ height: isBinary || (isLarge && !forceLoad) ? 80 : editorHeight }}>
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Loading…
            </div>
          ) : isBinary ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Binary file
            </div>
          ) : isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
              <span>Large diff ({totalDiffLines} lines). Loading may be slow.</span>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-muted"
                onClick={() => setForceLoad(true)}
              >
                Load anyway
              </button>
            </div>
          ) : diff ? (
            <MonacoDiff
              original={diff.originalContent ?? ''}
              modified={diff.modifiedContent ?? ''}
              language={language}
              diffStyle={diffStyle}
              onHeightChange={setContentHeight}
            />
          ) : null}
        </div>
      )}
    </div>
  );
}
