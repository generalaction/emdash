import { observer } from 'mobx-react-lite';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { GitChangeStatusIcon } from '../../diff-view/changes-panel/components/changes-list-item';
import type { ResolvedDiffTab } from '../../tabs/tab-manager-store';
import { TabCloseButton } from './tab-close-button';
import { TabDragPreviewShell, TabItemShell } from './tab-item-shell';
import { TabTitle } from './tab-title';

export function diffGroupSuffix(diffGroup: ResolvedDiffTab['diffGroup']): string {
  switch (diffGroup) {
    case 'disk':
      return '(Working Tree)';
    case 'staged':
      return '(Index)';
    case 'pr':
      return '(PR)';
    case 'git':
      return '(Git)';
  }
}

export const DiffTabItem = observer(function DiffTabItem({
  tab,
  onSelect,
  onPin,
  onClose,
}: {
  tab: ResolvedDiffTab;
  onSelect: () => void;
  onPin: () => void;
  onClose: () => void;
}) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  const suffix = diffGroupSuffix(tab.diffGroup);
  const hasUnsavedChanges = tab.isDirty;

  return (
    <TabItemShell
      tabId={tab.tabId}
      isActive={tab.isActive}
      title={
        tab.isPreview
          ? `${tab.path} ${suffix} (preview — double-click to keep)`
          : `${tab.path} ${suffix}`
      }
      onSelect={onSelect}
      onPin={onPin}
      onClose={onClose}
    >
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} />
      </span>
      <TabTitle isActive={tab.isActive} isPreview={tab.isPreview}>
        {fileName}
        <span className="ml-1 text-xs text-foreground-muted">{suffix}</span>
      </TabTitle>
      <TabCloseButton
        onClose={onClose}
        ariaLabel={`Close ${fileName} ${suffix}`}
        statusIndicator={
          hasUnsavedChanges ? (
            <div
              className="size-2 rounded-full bg-foreground group-hover:opacity-0"
              title="Unsaved changes"
            />
          ) : tab.status ? (
            <span className="transition-opacity group-hover:opacity-0">
              <GitChangeStatusIcon status={tab.status} className="size-4" />
            </span>
          ) : undefined
        }
      />
    </TabItemShell>
  );
});

export function DiffTabDragPreview({ tab }: { tab: ResolvedDiffTab }) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  const suffix = diffGroupSuffix(tab.diffGroup);
  return (
    <TabDragPreviewShell>
      <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
        <FileIcon filename={fileName} />
      </span>
      <span className="max-w-[200px] truncate">{`${fileName} ${suffix}`}</span>
    </TabDragPreviewShell>
  );
}
