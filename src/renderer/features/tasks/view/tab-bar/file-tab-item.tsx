import { Loader2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { useDelayedBoolean } from '@renderer/lib/hooks/use-delay-boolean';
import { modelRegistry } from '@renderer/lib/monaco/monaco-model-registry';
import type { ResolvedFileTab } from '../../tabs/tab-manager-store';
import { TabCloseButton } from './tab-close-button';
import { TabDragPreviewShell, TabItemShell } from './tab-item-shell';
import { TabTitle } from './tab-title';

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

export const FileTabItem = observer(function FileTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedFileTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  const isMonacoFile =
    tab.path.endsWith('.md') ||
    tab.path.endsWith('.svg') ||
    !tab.path.includes('.') ||
    /\.(ts|tsx|js|jsx|json|css|html|py|go|rs|sh|yml|yaml|toml|txt)$/.test(tab.path);

  const diskUri = modelRegistry.toDiskUri(tab.bufferUri);
  const diskStatus = modelRegistry.modelStatus.get(diskUri) ?? 'loading';
  const hasFileIssue = diskStatus === 'error' || diskStatus === 'too-large';
  const showSpinner = useDelayedBoolean(isMonacoFile && diskStatus === 'loading', 200);

  const errorTooltip = hasFileIssue ? fileTabErrorTooltip(diskStatus, diskUri) : undefined;
  const baseTitle = tab.isPreview ? `${tab.path} (preview — double-click to keep)` : tab.path;
  const tabTitle = errorTooltip ? `${tab.path} — ${errorTooltip}` : baseTitle;

  return (
    <TabItemShell
      tabId={tab.tabId}
      isActive={tab.isActive}
      title={tabTitle}
      onSelect={onSelect}
      onPin={onPin}
    >
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        {showSpinner ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <FileIcon filename={fileName} />
        )}
      </span>
      <TabTitle isActive={tab.isActive} isPreview={tab.isPreview} hasError={hasFileIssue}>
        {fileName}
      </TabTitle>
      <TabCloseButton
        onClose={onClose}
        ariaLabel={`Close ${fileName}`}
        statusIndicator={
          tab.isDirty ? (
            <div
              className="size-2 rounded-full bg-foreground group-hover:opacity-0"
              title="Unsaved changes"
            />
          ) : undefined
        }
      />
    </TabItemShell>
  );
});

export function FileTabDragPreview({ tab }: { tab: ResolvedFileTab }) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  return (
    <TabDragPreviewShell>
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} />
      </span>
      <span className="max-w-[200px] truncate">{fileName}</span>
    </TabDragPreviewShell>
  );
}
