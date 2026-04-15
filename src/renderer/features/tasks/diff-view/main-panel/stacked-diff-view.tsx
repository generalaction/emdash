import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HEAD_REF, STAGED_REF, type GitChange, type GitRef } from '@shared/git';
import { StackedDiffViewModel } from '@renderer/features/tasks/diff-view/stores/stacked-diff-view-model';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { isBinaryForDiff } from '@renderer/lib/editor/fileKind';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { buildMonacoModelPath } from '@renderer/lib/monaco/monacoModelPath';
import { PooledDiffEditor } from '@renderer/lib/monaco/pooled-diff-editor';
import { useModelStatus } from '@renderer/lib/monaco/use-model';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { getLanguageFromPath } from '@renderer/utils/languageUtils';
import { cn } from '@renderer/utils/utils';

const LARGE_DIFF_LINE_THRESHOLD = 2500;

export const StackedDiffView = observer(function StackedDiffView() {
  const provisioned = useProvisionedTask();
  const git = provisioned.workspace.git;
  const pr = provisioned.workspace.pr;
  const activeFile = provisioned.taskView.diffView.activeFile;
  const stagedFileChanges = git.stagedFileChanges;
  const unstagedFileChanges = git.unstagedFileChanges;

  if (activeFile?.group === 'pr') {
    const activePr = pr.pullRequests.find(
      (p) => activeFile.prNumber != null && p.metadata.number === activeFile.prNumber
    );
    const files = activePr ? (pr.getFiles(activePr).data ?? []) : [];
    return <StackedDiffPanel files={files} diffType="pr" originalRef={activeFile.originalRef} />;
  }

  const isStaged = activeFile?.group === 'staged';
  const files = isStaged ? stagedFileChanges : unstagedFileChanges;
  const diffType = isStaged ? ('staged' as const) : ('disk' as const);

  return <StackedDiffPanel files={files} diffType={diffType} originalRef={HEAD_REF} />;
});

interface StackedDiffPanelProps {
  files: GitChange[];
  diffType: 'disk' | 'staged' | 'git' | 'pr';
  /** Git ref for the left (original/before) side. Ignored for 'staged'. */
  originalRef: GitRef;
}

const StackedDiffPanel = observer(function StackedDiffPanel({
  files,
  diffType,
  originalRef,
}: StackedDiffPanelProps) {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const diffView = provisioned.taskView.diffView;
  const activeFile = diffView.activeFile;
  const viewMode = diffView.viewMode;
  const diffStyle = diffView.diffStyle;

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const programmaticScrollTarget = useRef<string | null>(null);

  const stackedDiffViewModel = useMemo(() => new StackedDiffViewModel(), []);

  const filePathsKey = useMemo(() => files.map((f) => f.path).join(','), [files]);

  useEffect(() => {
    stackedDiffViewModel.pruneStale(new Set(files.map((f) => f.path)));
    // filePathsKey is derived from files; when it changes, `files` in closure is current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filePathsKey, stackedDiffViewModel]);

  const scrollSyncRef = useRef({
    files,
    diffType,
    originalRef,
    diffView,
    programmaticScrollTarget,
  });
  scrollSyncRef.current = {
    files,
    diffType,
    originalRef,
    diffView,
    programmaticScrollTarget,
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
    gap: 8,
    overscan: 8,
    onChange: (instance) => {
      const {
        files: f,
        diffType: dt,
        originalRef: ref,
        diffView: dv,
        programmaticScrollTarget: target,
      } = scrollSyncRef.current;
      const startIndex = instance.range?.startIndex;
      if (startIndex == null) return;
      const topFile = f[startIndex];
      if (!topFile) return;

      if (target.current) {
        if (topFile.path === target.current) {
          target.current = null;
        }
        return;
      }

      dv.setActiveFile({
        path: topFile.path,
        type: dt === 'disk' ? 'disk' : 'git',
        group: dt,
        originalRef: ref,
      });
    },
  });

  // Click → scroll: when activeFile changes or mode switches back to stacked
  useEffect(() => {
    if (viewMode !== 'stacked') return;
    if (activeFile?.group !== diffType) return;
    const index = files.findIndex((f) => f.path === activeFile?.path);
    if (index < 0) return;

    const currentTopIndex = virtualizer.range?.startIndex;
    if (currentTopIndex === index) return;

    programmaticScrollTarget.current = activeFile.path;
    virtualizer.scrollToIndex(index, { align: 'start', behavior: 'auto' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile?.path, activeFile?.group, viewMode, files, diffType, virtualizer]);

  if (files.length === 0) {
    return (
      <EmptyState label="No changes" description="Select or make changes to files to see diffs." />
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
                projectId={projectId}
                workspaceId={workspaceId}
                diffStyle={diffStyle}
                diffType={diffType}
                originalRef={originalRef}
                viewModel={stackedDiffViewModel}
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
  projectId: string;
  workspaceId: string;
  diffStyle: 'unified' | 'split';
  diffType: 'disk' | 'staged' | 'git' | 'pr';
  /** Git ref for the left (original/before) side. Used when diffType is 'disk', 'git', or 'pr'. */
  originalRef: GitRef;
  viewModel: StackedDiffViewModel;
}

const MIN_EDITOR_HEIGHT = 100;

const StackedFileSection = observer(function StackedFileSection({
  file,
  projectId,
  workspaceId,
  diffStyle,
  diffType,
  originalRef,
  viewModel,
}: StackedFileSectionProps) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);

  const uri = buildMonacoModelPath(`workspace:${workspaceId}`, file.path);
  const language = getLanguageFromPath(file.path);
  const isBinary = isBinaryForDiff(file.path);

  // 'disk':   original = git://HEAD,        modified = disk://
  // 'staged': original = git://HEAD,        modified = git://staged
  // 'git':    original = git://originalRef, modified = git://HEAD
  // 'pr':     original = git://originalRef, modified = git://HEAD
  const originalUri =
    diffType === 'git' || diffType === 'pr'
      ? modelRegistry.toGitUri(uri, originalRef)
      : modelRegistry.toGitUri(uri, HEAD_REF);
  const modifiedUri =
    diffType === 'staged'
      ? modelRegistry.toGitUri(uri, STAGED_REF)
      : diffType === 'git' || diffType === 'pr'
        ? modelRegistry.toGitUri(uri, HEAD_REF)
        : modelRegistry.toDiskUri(uri);

  useEffect(() => {
    if (isBinary) return;
    const root = `workspace:${workspaceId}`;
    if (diffType === 'staged') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', HEAD_REF)
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else if (diffType === 'git') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', originalRef)
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', HEAD_REF)
        .catch(() => {});
    } else {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'disk')
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', originalRef)
        .catch(() => {});
    }
    return () => {
      modelRegistry.unregisterModel(originalUri);
      modelRegistry.unregisterModel(modifiedUri);
    };
  }, [
    isBinary,
    projectId,
    workspaceId,
    file.path,
    language,
    diffType,
    originalRef,
    originalUri,
    modifiedUri,
  ]);

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

  const expanded = viewModel.isExpanded(file.path);
  const forceLoad = viewModel.isForceLoaded(file.path);

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;

  return (
    <div className="border-border border rounded-lg overflow-hidden">
      <div
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-2 text-sm hover:bg-background-1',
          expanded && 'border-b border-border'
        )}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground-muted"
          onClick={() => viewModel.toggleExpanded(file.path)}
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="flex items-center gap-1.5">
            <FileIcon filename={fileName} size={12} />
            <span className="text-foreground">{fileName}</span>
          </span>
          {dirPath && <span className="truncate text-foreground-muted text-xs">{dirPath}</span>}
        </button>
        <span className="shrink-0 text-xs">
          <span className="text-green-500">+{file.additions}</span>{' '}
          <span className="text-red-500">-{file.deletions}</span>
        </span>
      </div>

      {expanded && (
        <div style={{ height: isBinary || (isLarge && !forceLoad) ? 80 : editorHeight }}>
          {isBinary ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-passive">
              Binary file
            </div>
          ) : isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-foreground-passive">
              Loading…
            </div>
          ) : isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-foreground-passive">
              <span>Large diff ({totalDiffLines} lines). Loading may be slow.</span>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-background-1"
                onClick={() => viewModel.setForceLoad(file.path)}
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
