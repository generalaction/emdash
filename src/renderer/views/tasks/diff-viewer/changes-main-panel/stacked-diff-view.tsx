import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitChange } from '@shared/git';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { useModelStatus } from '@renderer/core/monaco/use-model';
import { isBinaryForDiff } from '@renderer/lib/fileKind';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { buildMonacoModelPath } from '@renderer/lib/monacoModelPath';
import { useTaskViewContext } from '../../task-view-context';
import { useGitChangesContext } from '../state/git-changes-provider';
import { useGitViewContext } from '../state/git-view-provider';
import { PooledDiffEditor } from './pooled-diff-editor';

const LARGE_DIFF_LINE_THRESHOLD = 2500;

/**
 * Maximum number of files for which models are bulk-registered at panel mount.
 * Above this threshold a warning is shown instead of the full diff list.
 */
const MAX_STACKED_FILES = 75;

// ---------------------------------------------------------------------------
// StackedDiffView — single panel, switches based on activeFile.isStaged
// ---------------------------------------------------------------------------

export function StackedDiffView() {
  const { activeFile } = useGitViewContext();
  const isStaged = activeFile?.isStaged ?? false;

  return <StackedDiffPanel isStaged={isStaged} />;
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
    gap: 4,
    overscan: 8,
    onChange: (instance) => {
      const { files: f, isStaged: s, setActiveFile: setFile, suppress } = scrollSyncRef.current;
      if (!suppress.current) {
        const startIndex = instance.range?.startIndex;
        if (startIndex != null) {
          const file = f[startIndex];
          if (file) setFile({ path: file.path, isStaged: s });
        }
      }
    },
  });

  // Bulk register models for all non-binary files on mount.
  // FS watching is driven by useModelStatus inside each StackedFileSection —
  // visible sections subscribe, invoking FS watching; sections scrolled out of
  // view unsubscribe, pausing watching after 60 s TTL.
  useEffect(() => {
    if (files.length > MAX_STACKED_FILES) return;

    const registered: Array<{ diskUri: string; gitUri: string }> = [];

    void (async () => {
      for (const file of files) {
        if (isBinaryForDiff(file.path)) continue;
        const language = getLanguageFromPath(file.path);
        try {
          await modelRegistry.registerModel(
            projectId,
            taskId,
            `task:${taskId}`,
            file.path,
            language,
            'disk'
          );
          await modelRegistry.registerModel(
            projectId,
            taskId,
            `task:${taskId}`,
            file.path,
            language,
            'git'
          );
          const uri = buildMonacoModelPath(`task:${taskId}`, file.path);
          registered.push({
            diskUri: modelRegistry.toDiskUri(uri),
            gitUri: modelRegistry.toGitUri(uri, 'HEAD'),
          });
        } catch {
          // Ignore individual file registration errors
        }
      }
    })();

    return () => {
      for (const { diskUri, gitUri } of registered) {
        modelRegistry.unregisterModel(diskUri);
        modelRegistry.unregisterModel(gitUri);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId]);

  // Click → scroll: when activeFile changes or mode switches back to stacked
  useEffect(() => {
    if (viewMode !== 'stacked') return;
    if (activeFile?.isStaged !== isStaged) return;
    const index = files.findIndex((f) => f.path === activeFile?.path);
    if (index < 0) return;

    const currentTopIndex = virtualizer.range?.startIndex;
    if (currentTopIndex === index) return;

    suppressObserver.current = true;
    virtualizer.scrollToIndex(index, {
      align: 'start',
      behavior: activeFile.scrollBehavior ?? 'smooth',
    });
    const timer = setTimeout(() => {
      suppressObserver.current = false;
    }, 700);
    return () => clearTimeout(timer);
    // scrollBehavior is intentionally omitted — see comment in original
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path, activeFile?.isStaged, viewMode, files, isStaged, virtualizer]);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No {isStaged ? 'staged changes' : 'changes'}
      </div>
    );
  }

  if (files.length > MAX_STACKED_FILES) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>Too many changed files ({files.length}).</span>
        <span className="text-xs">Select individual files from the sidebar to view diffs.</span>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="h-full overflow-y-auto p-2 bg-white shadow-xs">
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
              <StackedFileSection file={file} taskId={taskId} diffStyle={diffStyle} />
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
  taskId: string;
  diffStyle: 'unified' | 'split';
}

const MIN_EDITOR_HEIGHT = 100;

function StackedFileSection({ file, taskId, diffStyle }: StackedFileSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [forceLoad, setForceLoad] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const uri = buildMonacoModelPath(`task:${taskId}`, file.path);
  const diskUri = modelRegistry.toDiskUri(uri);
  const gitUri = modelRegistry.toGitUri(uri, 'HEAD');
  const language = getLanguageFromPath(file.path);
  const isBinary = isBinaryForDiff(file.path);

  // Subscribe to model status — drives FS watching while this section is visible.
  // Mount of this component signals that the section is in the virtualizer viewport.
  // Unmount (scrolled out) stops FS watching via TTL eviction in subscribeToUri.
  const diskStatus = useModelStatus(diskUri);
  const gitStatus = useModelStatus(gitUri);
  const isLoading = diskStatus === 'loading' || gitStatus === 'loading';

  const parts = file.path.split('/');
  const fileName = parts.pop() || file.path;
  const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';

  const totalDiffLines = file.additions + file.deletions;
  const isLarge = totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;

  return (
    <div className="border-border border rounded-lg">
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
          {isBinary ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Binary file
            </div>
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              Loading…
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
          ) : (
            <PooledDiffEditor
              originalUri={gitUri}
              modifiedUri={uri}
              language={language}
              diffStyle={diffStyle}
              onHeightChange={setContentHeight}
            />
          )}
        </div>
      )}
    </div>
  );
}
