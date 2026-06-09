import { ChevronDown, ChevronRight } from 'lucide-react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { isMissingFileError } from '@renderer/features/tasks/diff-view/main-panel/missing-file-error';
import type { DiffViewStore } from '@renderer/features/tasks/diff-view/stores/diff-view-store';
import {
  StackedDiffPanelStore,
  type DiffSlotStore,
} from '@renderer/features/tasks/diff-view/stores/stacked-diff-panel-store';
import {
  useTaskViewContext,
  useWorkspace,
  useWorkspaceId,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { ShowHide } from '@renderer/lib/ui/show-hide';
import { formatDiffLineCount } from '@renderer/utils/format-diff-line-count';
import { cn } from '@renderer/utils/utils';
import { HEAD_REF, STAGED_REF } from '@shared/core/git/git';

const LARGE_DIFF_LINE_THRESHOLD = 1500;

export const StackedDiffView = observer(function StackedDiffView() {
  const { projectId } = useTaskViewContext();
  const workspaceId = useWorkspaceId();
  const taskView = useWorkspaceViewModel();
  const workspace = useWorkspace();
  const diffView = taskView.diffView;
  const git = workspace.git;
  const pr = taskView.prStore;

  const panelStore = useMemo(
    () => (diffView ? new StackedDiffPanelStore(projectId, workspaceId, diffView, git, pr!) : null),
    // oxlint-disable-next-line react/exhaustive-deps
    []
  );

  useEffect(() => {
    return () => panelStore?.dispose();
    // oxlint-disable-next-line react/exhaustive-deps
  }, []);

  if (!panelStore) return null;

  return <StackedDiffPanel panelStore={panelStore} />;
});

interface StackedDiffPanelProps {
  panelStore: StackedDiffPanelStore;
}

const StackedDiffPanel = observer(function StackedDiffPanel({ panelStore }: StackedDiffPanelProps) {
  const diffView = useWorkspaceViewModel().diffView;
  const { visibleSlots } = panelStore;
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to the active file whenever its path changes (e.g. sidebar click).
  // isProgrammaticScroll suppresses the onScroll debounce while the jump is in flight.
  useEffect(
    () =>
      reaction(
        () => diffView?.activeFile?.path,
        (path) => {
          if (!path || !scrollRef.current) return;
          const el = scrollRef.current.querySelector<HTMLElement>(
            `[data-file-path="${CSS.escape(path)}"]`
          );
          if (!el) return;
          // Skip scroll if already visible — prevents the post-debounce jump where
          // setActiveFile triggers the reaction even though the file is on screen.
          const containerRect = scrollRef.current.getBoundingClientRect();
          const elRect = el.getBoundingClientRect();
          const alreadyVisible =
            elRect.bottom > containerRect.top && elRect.top < containerRect.bottom;
          if (alreadyVisible) return;
          isProgrammaticScroll.current = true;
          el.scrollIntoView({ block: 'nearest' });
          requestAnimationFrame(() => {
            isProgrammaticScroll.current = false;
          });
        }
      ),
    [diffView]
  );

  // Cleanup debounce timer on unmount.
  useEffect(
    () => () => {
      if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    },
    []
  );

  if (!diffView) return null;

  function handleScroll() {
    if (isProgrammaticScroll.current) return;
    if (scrollEndTimer.current) clearTimeout(scrollEndTimer.current);
    scrollEndTimer.current = setTimeout(() => {
      const container = scrollRef.current;
      if (!container) return;
      const containerTop = container.getBoundingClientRect().top;
      const el = [...container.querySelectorAll<HTMLElement>('[data-file-path]')].find(
        (node) => node.getBoundingClientRect().bottom > containerTop
      );
      const path = el?.dataset.filePath;
      if (!path) return;
      const slot = panelStore.visibleSlots.find((s) => s.file?.path === path);
      if (!slot?.file || !diffView) return;
      diffView.setActiveFile({
        path: slot.file.path,
        type: slot.diffType === 'disk' ? 'disk' : 'git',
        group: slot.diffType,
        originalRef: slot.originalRef,
        modifiedRef:
          slot.diffType === 'git' || slot.diffType === 'pr' ? slot.modifiedRef : undefined,
        prNumber: slot.prNumber,
        prBaseOid: slot.prBaseOid,
        prHeadOid: slot.prHeadOid,
        commitOriginalSha: slot.commitOriginalSha,
        commitModifiedSha: slot.commitModifiedSha,
      });
    }, 150);
  }

  if (visibleSlots.length === 0) {
    return (
      <EmptyState label="No changes" description="Select or make changes to files to see diffs." />
    );
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto p-2 shadow-xs" onScroll={handleScroll}>
      {visibleSlots.map((slotStore, i) => (
        // key=index is intentional: slots are stable by position; content swaps in-place.
        <StackedFileSlot
          key={i}
          slotStore={slotStore}
          panelStore={panelStore}
          diffView={diffView}
        />
      ))}
    </div>
  );
});

interface StackedFileSlotProps {
  slotStore: DiffSlotStore;
  panelStore: StackedDiffPanelStore;
  diffView: DiffViewStore;
}

const MIN_EDITOR_HEIGHT = 100;

const StackedFileSlot = observer(function StackedFileSlot({
  slotStore,
  panelStore,
  diffView,
}: StackedFileSlotProps) {
  const [contentHeight, setContentHeight] = useState<number | null>(null);
  const sectionRef = useRef<HTMLDivElement>(null);

  const { file, originalUri, modifiedUri, language, isBinary, diffType, originalRef, modifiedRef } =
    slotStore;

  // Register/unregister models whenever URIs change (group switch, file change at slot).
  // Runs even when file is null; isBinary guard inside skips registration cleanly.
  useEffect(() => {
    if (!file || isBinary) return;
    const { projectId, workspaceId } = slotStore;
    const root = `workspace:${workspaceId}`;
    let disposed = false;

    if (diffType === 'staged') {
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', HEAD_REF)
        .catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', STAGED_REF)
        .catch(() => {});
    } else if (diffType === 'git' || diffType === 'pr') {
      const effectiveModifiedRef = modifiedRef ?? HEAD_REF;
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', originalRef)
        .catch(() => {});
      void modelRegistry
        .registerModel(
          projectId,
          workspaceId,
          root,
          file.path,
          language,
          'git',
          effectiveModifiedRef
        )
        .catch(() => {});
    } else {
      const diskUri = modelRegistry.toDiskUri(modifiedUri);
      void (async () => {
        if (file.status !== 'deleted') {
          try {
            await modelRegistry.registerModel(
              projectId,
              workspaceId,
              root,
              file.path,
              language,
              'disk'
            );
          } catch (err) {
            if (!isMissingFileError(err)) throw err;
          }
        }
        if (disposed) {
          modelRegistry.unregisterModel(diskUri);
          return;
        }
        await modelRegistry.registerModel(
          projectId,
          workspaceId,
          root,
          file.path,
          language,
          'buffer'
        );
        if (disposed) {
          modelRegistry.unregisterModel(modifiedUri);
        }
      })().catch(() => {});
      void modelRegistry
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', STAGED_REF)
        .catch(() => {});
    }
    return () => {
      disposed = true;
      modelRegistry.unregisterModel(originalUri);
      modelRegistry.unregisterModel(modifiedUri);
      if (diffType === 'disk') {
        modelRegistry.unregisterModel(modelRegistry.toDiskUri(modifiedUri));
      }
    };
  }, [
    isBinary,
    originalUri,
    modifiedUri,
    language,
    diffType,
    originalRef,
    modifiedRef,
    file,
    file?.status,
    slotStore,
  ]);

  if (!file) return null;

  const expanded = panelStore.isExpanded(file.path);
  const forceLoad = panelStore.isForceLoaded(file.path);
  const totalDiffLines = file.additions + file.deletions;
  const isLarge = totalDiffLines > LARGE_DIFF_LINE_THRESHOLD;
  const diffStyle = diffView.diffStyle;

  const editorHeight =
    contentHeight != null ? Math.max(contentHeight, MIN_EDITOR_HEIGHT) : MIN_EDITOR_HEIGHT;

  const parts = file.path.split('/');
  const fileName = parts.pop() || file.path;
  const dirPath = parts.length > 0 ? parts.join('/') + '/' : '';

  return (
    <div
      ref={sectionRef}
      data-file-path={file.path}
      className="mb-2 overflow-hidden rounded-lg border border-border"
    >
      <div
        className={cn(
          'flex w-full items-center gap-1.5 px-3 py-2 text-sm hover:bg-background-1',
          expanded && 'border-b border-border'
        )}
      >
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-foreground-muted"
          onClick={() => panelStore.toggleExpanded(file.path)}
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
          {dirPath && <span className="truncate text-xs text-foreground-muted">{dirPath}</span>}
        </button>
        <span className="shrink-0 text-xs">
          <span className="text-foreground-success">+{formatDiffLineCount(file.additions)}</span>{' '}
          <span className="text-foreground-error">-{formatDiffLineCount(file.deletions)}</span>
        </span>
      </div>

      <ShowHide visible={expanded}>
        <div style={{ height: isBinary || (isLarge && !forceLoad) ? 80 : editorHeight }}>
          {isBinary ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-passive">
              Binary file
            </div>
          ) : isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-foreground-passive">
              <span>
                Large diff ({formatDiffLineCount(totalDiffLines)} lines). Loading may be slow.
              </span>
              <button
                className="rounded-md border border-border px-3 py-1 text-xs font-medium hover:bg-background-1"
                onClick={() => panelStore.setForceLoad(file.path)}
              >
                Load anyway
              </button>
            </div>
          ) : (
            <StickyDiffEditor
              originalUri={originalUri}
              modifiedUri={modifiedUri}
              diffStyle={diffStyle}
              onHeightChange={setContentHeight}
            />
          )}
        </div>
      </ShowHide>
    </div>
  );
});
