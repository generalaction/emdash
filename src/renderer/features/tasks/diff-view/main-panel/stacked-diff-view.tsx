import { ChevronDown, ChevronRight } from 'lucide-react';
import { reaction } from 'mobx';
import { observer } from 'mobx-react-lite';
import { Activity, useEffect, useMemo, useRef, useState } from 'react';
import { HEAD_REF, STAGED_REF } from '@shared/git';
import {
  DiffSlotStore,
  StackedDiffPanelStore,
} from '@renderer/features/tasks/diff-view/stores/stacked-diff-panel-store';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import { StickyDiffEditor } from '@renderer/lib/monaco/sticky-diff-editor';
import { EmptyState } from '@renderer/lib/ui/empty-state';
import { cn } from '@renderer/utils/utils';

const LARGE_DIFF_LINE_THRESHOLD = 1500;

export const StackedDiffView = observer(function StackedDiffView() {
  const { projectId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const { workspaceId } = provisioned;
  const diffView = provisioned.taskView.diffView;
  const git = provisioned.workspace.git;
  const pr = provisioned.workspace.pr;

  const panelStore = useMemo(
    () => new StackedDiffPanelStore(projectId, workspaceId, diffView, git, pr),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    return () => panelStore.dispose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <StackedDiffPanel panelStore={panelStore} />;
});

interface StackedDiffPanelProps {
  panelStore: StackedDiffPanelStore;
}

const StackedDiffPanel = observer(function StackedDiffPanel({ panelStore }: StackedDiffPanelProps) {
  const provisioned = useProvisionedTask();
  const diffView = provisioned.taskView.diffView;
  const { visibleSlots } = panelStore;
  const scrollRef = useRef<HTMLDivElement>(null);
  const isProgrammaticScroll = useRef(false);
  const scrollEndTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Scroll to the active file whenever its path changes (e.g. sidebar click).
  // isProgrammaticScroll suppresses the onScroll debounce while the jump is in flight.
  useEffect(
    () =>
      reaction(
        () => diffView.activeFile?.path,
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
      if (!slot?.file) return;
      diffView.setActiveFile({
        path: slot.file.path,
        type: slot.diffType === 'disk' ? 'disk' : 'git',
        group: slot.diffType,
        originalRef: slot.originalRef,
        modifiedRef: slot.diffType === 'pr' ? slot.modifiedRef : undefined,
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
  diffView: ReturnType<typeof useProvisionedTask>['taskView']['diffView'];
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
      const effectiveModifiedRef = diffType === 'pr' ? modifiedRef : HEAD_REF;
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
        await modelRegistry.registerModel(
          projectId,
          workspaceId,
          root,
          file.path,
          language,
          'disk'
        );
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
        .registerModel(projectId, workspaceId, root, file.path, language, 'git', originalRef)
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
      className="border-border mb-2 overflow-hidden rounded-lg border"
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
          <span className="text-green-500">+{file.additions}</span>{' '}
          <span className="text-red-500">-{file.deletions}</span>
        </span>
      </div>

      <Activity mode={expanded ? 'visible' : 'hidden'}>
        <div style={{ height: isBinary || (isLarge && !forceLoad) ? 80 : editorHeight }}>
          {isBinary ? (
            <div className="flex h-full items-center justify-center text-sm text-foreground-passive">
              Binary file
            </div>
          ) : isLarge && !forceLoad ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-foreground-passive">
              <span>Large diff ({totalDiffLines} lines). Loading may be slow.</span>
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
      </Activity>
    </div>
  );
});
