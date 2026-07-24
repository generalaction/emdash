import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { modelRegistry } from '@core/features/editor/api/browser/monaco/monaco-model-registry';
import { FileIcon } from '@core/features/editor/api/browser/renderers/file-icon';
import type { FileTabResource } from '@core/features/editor/api/browser/task-editor/stores/file-tab-resource';
import type {
  TabBarItemProps,
  ResolvedTab,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@core/primitives/workbench-shell/browser/tabs/tab-bar/generic-tab-item';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { isFileTabLoading } from './file-tab-loading';

function fileTabErrorTooltip(diskStatus: string, diskUri: string): string | undefined {
  if (diskStatus === 'error') return 'File not found';
  if (diskStatus === 'too-large') {
    const bytes = modelRegistry.modelTotalSizes.get(diskUri);
    if (bytes == null) return 'File too large to display';
    if (bytes < 1024) return `File too large to display (${bytes} B)`;
    if (bytes < 1024 * 1024) return `File too large to display (${(bytes / 1024).toFixed(1)} KB)`;
    return `File too large to display (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
  }
  return undefined;
}

export const FileTabBarItem = observer(function FileTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<FileTabResource>) {
  const resource = tab.resource;
  const fileName = resource.path.split('/').pop() ?? 'Untitled';
  const isMonacoFile =
    resource.path.endsWith('.md') ||
    resource.path.endsWith('.svg') ||
    !resource.path.includes('.') ||
    /\.(ts|tsx|js|jsx|json|css|html|py|go|rs|sh|yml|yaml|toml|txt)$/.test(resource.path);

  const bufferUri = resource.bufferUri;
  const diskUri = bufferUri ? modelRegistry.toDiskUri(bufferUri) : '';
  const diskStatus = diskUri ? modelRegistry.modelStatus.get(diskUri) : undefined;
  const hasFileIssue = diskStatus === 'error' || diskStatus === 'too-large';
  const showSpinner = useDelayedBoolean(
    isFileTabLoading({
      isExternal: resource.isExternal,
      isExternalLoading: resource.isLoading,
      isMonacoFile,
      diskStatus,
    }),
    200
  );

  const errorTooltip = hasFileIssue ? fileTabErrorTooltip(diskStatus, diskUri) : undefined;
  const tooltip = errorTooltip ? `${resource.path} — ${errorTooltip}` : resource.path;

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
      hasError={hasFileIssue}
      statusSlot={
        resource.isDirty ? (
          <div
            className="size-2 rounded-full bg-foreground group-hover:opacity-0"
            title="Unsaved changes"
          />
        ) : undefined
      }
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
