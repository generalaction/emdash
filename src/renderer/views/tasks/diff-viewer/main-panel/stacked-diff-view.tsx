import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GitChange } from '@shared/git';
import { isBinaryForDiff } from '@renderer/core/editor/fileKind';
import { modelRegistry } from '@renderer/core/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/core/monaco/monacoModelPath';
import { PooledDiffEditor } from '@renderer/core/monaco/pooled-diff-editor';
import { useModelStatus } from '@renderer/core/monaco/use-model';
import { asProvisioned, getTaskStore } from '@renderer/core/stores/task-selectors';
import { getLanguageFromPath } from '@renderer/lib/languageUtils';
import { usePrContext } from '@renderer/views/tasks/diff-viewer/state/pr-provider';
import { useTaskViewContext } from '@renderer/views/tasks/task-view-context';

const LARGE_DIFF_LINE_THRESHOLD = 2500;

/**
 * Maximum number of files for which models are bulk-registered at panel mount.
 * Above this threshold a warning is shown instead of the full diff list.
 */
const MAX_STACKED_FILES = 75;

export const StackedDiffView = observer(function StackedDiffView() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = asProvisioned(getTaskStore(projectId, taskId));
  const git = provisioned?.git;
  const activeFile = provisioned?.diffView.activeFile ?? null;
  const stagedFileChanges = git?.stagedFileChanges ?? [];
  const unstagedFileChanges = git?.unstagedFileChanges ?? [];
  const { pullRequests, prFilesMap } = usePrContext();

  if (activeFile?.type === 'git') {
    const originalRef = activeFile.originalRef;
    const pr = pullRequests.find((p) => p.metadata.baseRefName === originalRef);
    const files = pr ? (prFilesMap[pr.id] ?? []) : [];
    return <StackedDiffPanel files={files} diffType="git" originalRef={originalRef} />;
  }

  const isStaged = activeFile?.type === 'staged';
  const files = isStaged ? stagedFileChanges : unstagedFileChanges;
  const diffType = isStaged ? ('staged' as const) : ('disk' as const);

  return <StackedDiffPanel files={files} diffType={diffType} originalRef="HEAD" />;
});

interface StackedDiffPanelProps {
  files: GitChange[];
  diffType: 'disk' | 'staged' | 'git';
  /** Git ref for the left (original/before) side. Ignored for 'staged'. */
  originalRef: string;
}

const StackedDiffPanel = observer(function StackedDiffPanel({
  files,
  diffType,
  originalRef,
}: StackedDiffPanelProps) {
  const { projectId, taskId } = useTaskViewContext();
  const diffView = asProvisioned(getTaskStore(projectId, taskId))?.diffView;
  const activeFile = diffView?.activeFile ?? null;
  const viewMode = diffView?.viewMode ?? 'stacked';
  const diffStyle = diffView?.diffStyle ?? 'unified';

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const suppressObserver = useRef(false);

  const scrollSyncRef = useRef({
    files,
    diffType,
    originalRef,
    diffView,
    suppress: suppressObserver,
  });
  scrollSyncRef.current = {
    files,
    diffType,
    originalRef,
    diffView,
    suppress: suppressObserver,
  };

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
      const {
        files: f,
        diffType: dt,
        originalRef: ref,
        diffView: dv,
        suppress,
      } = scrollSyncRef.current;
      if (!suppress.current) {
        const startIndex = instance.range?.startIndex;
        if (startIndex != null) {
          const file = f[startIndex];
          if (file) dv?.setActiveFile({ path: file.path, type: dt, originalRef: ref });
        }
      }
    },
  });

  // Stable dep: re-register whenever the file set or the base ref changes.
  // Using a joined-path key avoids reacting to array reference identity churn
  // (React Query returns a new array object on every refetch even if data is unchanged).
  const filePathsKey = useMemo(() => files.map((f) => f.path).join(','), [files]);

  // Bulk register models for all non-binary files whenever the file list or
  // originalRef changes. FS watching is driven by useModelStatus inside each
  // StackedFileSection — visible sections subscribe, invoking FS watching;
  // sections scrolled out of view unsubscribe, pausing watching after 60 s TTL.
  useEffect(() => {
    if (files.length > MAX_STACKED_FILES) return;

    // Track registered URIs in a plain object so the async loop and the cleanup
    // closure share the same reference (a local `const` inside a void IIFE would
    // be captured by value before any pushes happen if the component unmounts
    // between iterations).
    const registered: Array<{ originalUri: string; modifiedUri: string }> = [];
    const aborted = { value: false };

    void (async () => {
      for (const file of files) {
        if (aborted.value) break;
        if (isBinaryForDiff(file.path)) continue;
        const language = getLanguageFromPath(file.path);
        const root = `task:${taskId}`;
        try {
          if (diffType === 'staged') {
            await modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              file.path,
              language,
              'git',
              'HEAD'
            );
            await modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              file.path,
              language,
              'git',
              'staged'
            );
          } else if (diffType === 'git') {
            await modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              file.path,
              language,
              'git',
              originalRef
            );
            await modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              file.path,
              language,
              'git',
              'HEAD'
            );
          } else {
            await modelRegistry.registerModel(projectId, taskId, root, file.path, language, 'disk');
            await modelRegistry.registerModel(
              projectId,
              taskId,
              root,
              file.path,
              language,
              'git',
              originalRef
            );
          }
          const uri = buildMonacoModelPath(root, file.path);
          registered.push({
            originalUri:
              diffType === 'git'
                ? modelRegistry.toGitUri(uri, originalRef)
                : modelRegistry.toGitUri(uri, 'HEAD'),
            modifiedUri:
              diffType === 'staged'
                ? modelRegistry.toGitUri(uri, 'staged')
                : diffType === 'git'
                  ? modelRegistry.toGitUri(uri, 'HEAD')
                  : modelRegistry.toDiskUri(uri),
          });
        } catch {
          // Ignore individual file registration errors
        }
      }
    })();

    return () => {
      aborted.value = true;
      for (const { originalUri, modifiedUri } of registered) {
        modelRegistry.unregisterModel(originalUri);
        modelRegistry.unregisterModel(modifiedUri);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, taskId, diffType, originalRef, filePathsKey]);

  // Click → scroll: when activeFile changes or mode switches back to stacked
  useEffect(() => {
    if (viewMode !== 'stacked') return;
    if (activeFile?.type !== diffType) return;
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
  }, [activeFile?.path, activeFile?.type, viewMode, files, diffType, virtualizer]);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No {diffType === 'staged' ? 'staged changes' : 'changes'}
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
    <div ref={scrollContainerRef} className="h-full overflow-y-auto p-2 shadow-xs">
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
                taskId={taskId}
                diffStyle={diffStyle}
                diffType={diffType}
                originalRef={originalRef}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
});

interface StackedFileSectionProps {
  file: GitChange;
  taskId: string;
  diffStyle: 'unified' | 'split';
  diffType: 'disk' | 'staged' | 'git';
  /** Git ref for the left (original/before) side. Used when diffType is 'disk' or 'git'. */
  originalRef: string;
}

const MIN_EDITOR_HEIGHT = 100;

const StackedFileSection = observer(function StackedFileSection({
  file,
  taskId,
  diffStyle,
  diffType,
  originalRef,
}: StackedFileSectionProps) {
  const [expanded, setExpanded] = useState(true);
  const [forceLoad, setForceLoad] = useState(false);
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const uri = buildMonacoModelPath(`task:${taskId}`, file.path);
  const language = getLanguageFromPath(file.path);
  const isBinary = isBinaryForDiff(file.path);

  // 'disk':   original = git://HEAD,        modified = disk://
  // 'staged': original = git://HEAD,        modified = git://staged
  // 'git':    original = git://originalRef, modified = git://HEAD
  const originalUri =
    diffType === 'git'
      ? modelRegistry.toGitUri(uri, originalRef)
      : modelRegistry.toGitUri(uri, 'HEAD');
  const modifiedUri =
    diffType === 'staged'
      ? modelRegistry.toGitUri(uri, 'staged')
      : diffType === 'git'
        ? modelRegistry.toGitUri(uri, 'HEAD')
        : modelRegistry.toDiskUri(uri);

  // Subscribe to model status — drives FS watching while this section is visible.
  // Mount of this component signals that the section is in the virtualizer viewport.
  // Unmount (scrolled out) stops FS watching via TTL eviction in subscribeToUri.
  const originalStatus = useModelStatus(originalUri);
  const modifiedStatus = useModelStatus(modifiedUri);
  const isLoading = originalStatus === 'loading' || modifiedStatus === 'loading';

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
              originalUri={originalUri}
              modifiedUri={modifiedUri}
              language={language}
              diffStyle={diffStyle}
              onHeightChange={setContentHeight}
            />
          )}
        </div>
      )}
    </div>
  );
});
