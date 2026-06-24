import { observer } from 'mobx-react-lite';
import type { TabItemProps } from '@renderer/features/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@renderer/features/tabs/tab-bar/generic-tab-item';
import { TabTitle } from '@renderer/features/tabs/tab-bar/tab-title';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { GitChangeStatusIcon } from './changes-panel/components/changes-list-item';
import type { DiffResolvedData } from './diff-tab-provider';

export function diffGroupSuffix(diffGroup: DiffResolvedData['diffGroup']): string {
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
  host,
  ctx,
}: TabItemProps<DiffResolvedData>) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  const suffix = diffGroupSuffix(tab.diffGroup);

  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={fileName}
      tooltip={`${tab.path} ${suffix}`}
      preSlot={
        <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
          <FileIcon filename={fileName} />
        </span>
      }
      labelSlot={
        <TabTitle isActive={tab.isActive} isPreview={tab.isPreview}>
          {fileName}
          <span className="ml-1 text-xs text-foreground-muted">{suffix}</span>
        </TabTitle>
      }
      statusSlot={
        tab.status ? (
          <span className="transition-opacity group-hover:opacity-0">
            <GitChangeStatusIcon status={tab.status} className="size-4" />
          </span>
        ) : undefined
      }
    />
  );
});

export function DiffTabDragPreview({
  tab,
}: {
  tab: { path: string; diffGroup: DiffResolvedData['diffGroup'] };
}) {
  const fileName = tab.path.split('/').pop() ?? 'Untitled';
  const suffix = diffGroupSuffix(tab.diffGroup);
  return (
    <GenericTabDragPreview
      preSlot={
        <span className="shrink-0 [&>svg]:h-3 [&>svg]:w-3">
          <FileIcon filename={fileName} />
        </span>
      }
      label={`${fileName} ${suffix}`}
    />
  );
}
