import type { GitChangeStatus } from '@emdash/core/git';
import { observer } from 'mobx-react-lite';
import type {
  TabEntry,
  TabHandle,
  TabProvider,
  TabViewContext,
  TabContentProps,
} from '@renderer/features/tabs/core/tab-provider';
import { createTabProvider } from '@renderer/features/tabs/core/tab-provider-registry';
import type { ActiveFile } from '@shared/view-state';
import { DiffTabBarItem, DiffTabBarItemDragPreview } from './diff-tab-item';
import { DiffView } from './main-panel/diff-view';
import type { DiffPayload } from './stores/diff-tab-resource';
import { DiffTabResource } from './stores/diff-tab-resource';

export interface DiffOpenArgs {
  activeFile: ActiveFile;
  status?: GitChangeStatus;
  /** When true, opens as a preview tab (replaced on next preview open). */
  preview?: boolean;
}

function activeFileToDiffPayload(activeFile: ActiveFile, status?: GitChangeStatus): DiffPayload {
  return {
    path: activeFile.path,
    diffGroup: activeFile.group,
    originalRef: activeFile.originalRef,
    modifiedRef: activeFile.modifiedRef,
    prNumber: activeFile.prNumber,
    prBaseOid: activeFile.prBaseOid,
    prHeadOid: activeFile.prHeadOid,
    commitOriginalSha: activeFile.commitOriginalSha,
    commitModifiedSha: activeFile.commitModifiedSha,
    status,
  };
}

const DiffTabContent = observer(function DiffTabContent({ host }: TabContentProps) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  if (activeTab?.kind !== 'diff') return null;
  return <DiffView tab={activeTab.resource as DiffTabResource} />;
});

export const diffTabProvider: TabProvider<'diff', DiffPayload, DiffTabResource, DiffOpenArgs> =
  createTabProvider({
    kind: 'diff',

    // No mount: multi. No cross-pane or within-pane dedup (per architecture decision).

    onBeforeOpen(args: DiffOpenArgs): DiffPayload | null {
      return activeFileToDiffPayload(args.activeFile, args.status);
    },

    initialize(
      entry: TabEntry<DiffPayload>,
      handle: TabHandle,
      _ctx: TabViewContext
    ): DiffTabResource {
      void handle;
      return new DiffTabResource(entry.tabId, entry.state);
    },

    dispose(_entry: TabEntry<DiffPayload>, resource: DiffTabResource): void {
      resource.dispose();
    },

    TabBarItem: DiffTabBarItem,
    TabBarItemDragPreview: DiffTabBarItemDragPreview,
    TabContent: DiffTabContent,

    title(entry: TabEntry<DiffPayload>): string {
      const fileName = entry.state.path.split('/').pop() ?? 'Untitled';
      const suffix = diffGroupSuffix(entry.state.diffGroup);
      return `${fileName} ${suffix}`;
    },
  });

export function diffGroupSuffix(diffGroup: DiffPayload['diffGroup']): string {
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
