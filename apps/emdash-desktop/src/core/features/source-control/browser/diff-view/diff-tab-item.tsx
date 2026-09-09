import { observer } from 'mobx-react-lite';
import { FileIcon } from '@core/features/editor/contributions/browser/file-icon';
import type {
  TabBarItemProps,
  ResolvedTab,
} from '@core/primitives/workbench-shell/browser/tabs/core/tab-provider';
import {
  GenericTabDragPreview,
  GenericTabItem,
} from '@core/primitives/workbench-shell/browser/tabs/tab-bar/generic-tab-item';
import { TabTitle } from '@core/primitives/workbench-shell/browser/tabs/tab-bar/tab-title';
import { GitChangeStatusIcon } from './changes-panel/components/changes-list-item';
import type { DiffTabResource } from './stores/diff-tab-resource';

export function diffGroupSuffix(diffGroup: DiffTabResource['diffGroup']): string {
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

export const DiffTabBarItem = observer(function DiffTabBarItem({
  tab,
  host,
  ctx,
}: TabBarItemProps<DiffTabResource>) {
  const resource = tab.resource;
  const fileName = resource.path.split('/').pop() ?? 'Untitled';
  const suffix = diffGroupSuffix(resource.diffGroup);

  return (
    <GenericTabItem
      tab={tab}
      host={host}
      ctx={ctx}
      label={fileName}
      tooltip={`${resource.path} ${suffix}`}
      preSlot={<FileIcon filename={fileName} size={12} />}
      labelSlot={
        <TabTitle isActive={tab.isActive} isPreview={tab.isPreview}>
          {fileName}
          <span className="ml-1 text-xs text-foreground-muted">{suffix}</span>
        </TabTitle>
      }
      statusSlot={
        resource.status ? (
          <span className="transition-opacity group-hover:opacity-0">
            <GitChangeStatusIcon status={resource.status} className="size-4" />
          </span>
        ) : undefined
      }
    />
  );
});

export function DiffTabBarItemDragPreview({ tab }: { tab: ResolvedTab<DiffTabResource> }) {
  const resource = tab.resource;
  const fileName = resource.path.split('/').pop() ?? 'Untitled';
  const suffix = diffGroupSuffix(resource.diffGroup);
  return (
    <GenericTabDragPreview
      preSlot={<FileIcon filename={fileName} size={12} />}
      label={`${fileName} ${suffix}`}
    />
  );
}
