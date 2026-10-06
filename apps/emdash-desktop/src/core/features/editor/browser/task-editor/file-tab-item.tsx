import { FolderOpen, Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ContentStatus } from '@core/features/editor/api/browser/open-file-store/open-file-store';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import { FileIcon } from '@core/features/editor/contributions/browser/file-icon';
import { useTaskComposition } from '@core/features/workbench/api/browser/task-composition-context';
import { useDelayedBoolean } from '@core/primitives/react-hooks/browser/use-delay-boolean';
import { cn } from '@core/primitives/styling/browser/cn';
import type {
  TabBarItemProps,
  ResolvedTab,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@core/primitives/workbench-shell/browser/tabs/tab-bar/generic-tab-item';

function fileTabErrorTooltip(status: ContentStatus): string | undefined {
  if (status.kind !== 'error') return undefined;
  switch (status.code) {
    case 'not-found':
      return 'File not found';
    case 'no-permissions':
      return 'Permission denied';
    case 'too-large':
      return 'File too large to display';
    case 'binary':
      return 'Binary file';
    case 'unavailable':
      return 'Could not load file';
  }
}

/** Save state shown under the tab's close button. */
const FileTabSaveStatus = observer(function FileTabSaveStatus({
  resource,
}: {
  resource: FileTabResource;
}) {
  const entry = resource.entry;
  // Local writes finish well before this; slow remote ones show a spinner.
  const showSaving = useDelayedBoolean(entry?.saving ?? false, 300);
  if (!entry?.dirty) return null;
  if (entry.conflicted) {
    return (
      <SaveStatusDot className="bg-foreground-warning" title="Changed on disk. Save to resolve." />
    );
  }
  if (entry.saveFailed) {
    return <SaveStatusDot className="bg-foreground-error" title="Couldn't save changes" />;
  }
  if (showSaving) {
    return <Loader2 className="h-3 w-3 animate-spin group-hover:opacity-0" aria-label="Saving" />;
  }
  return <SaveStatusDot className="bg-foreground" title="Unsaved changes" />;
});

function SaveStatusDot({ className, title }: { className: string; title: string }) {
  return (
    <div className={cn('size-2 rounded-full group-hover:opacity-0', className)} title={title} />
  );
}

export const FileTabBarItem = observer(function FileTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<FileTabResource>) {
  const resource = tab.resource;
  const taskView = useTaskComposition();
  const fileName = resource.path.split('/').pop() ?? 'Untitled';

  const status = resource.contentStatus;
  const showSpinner = useDelayedBoolean(status.kind === 'loading', 200);

  const errorTooltip = fileTabErrorTooltip(status);
  const tooltip = errorTooltip ? `${resource.displayPath} — ${errorTooltip}` : resource.displayPath;

  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={fileName}
      tooltip={tooltip}
      preSlot={
        <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
          {showSpinner ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <FileIcon filename={fileName} />
          )}
        </span>
      }
      hasError={status.kind === 'error'}
      kindCommands={
        resource.inWorkspace
          ? [
              {
                id: 'file:reveal',
                label: 'Reveal File',
                icon: FolderOpen,
                group: 'file',
                run: () => {
                  taskView.revealWorkspaceFile(resource.path);
                },
              },
            ]
          : undefined
      }
      statusSlot={<FileTabSaveStatus resource={resource} />}
    />
  );
});

export function FileTabBarItemDragPreview({ tab }: { tab: ResolvedTab<FileTabResource> }) {
  const fileName = tab.resource.path.split('/').pop() ?? 'Untitled';
  return (
    <GenericTabDragPreview
      preSlot={
        <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
          <FileIcon filename={fileName} />
        </span>
      }
      label={fileName}
    />
  );
}
