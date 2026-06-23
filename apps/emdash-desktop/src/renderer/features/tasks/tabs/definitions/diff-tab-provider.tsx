import type { GitChangeStatus, GitObjectRef } from '@emdash/core/git';
import { observer } from 'mobx-react-lite';
import { DiffView } from '@renderer/features/tasks/diff-view/main-panel/diff-view';
import {
  DiffTabItem,
  DiffTabDragPreview,
  diffGroupSuffix,
} from '@renderer/features/tasks/view/tab-bar/diff-tab-item';
import { TabContextMenu } from '@renderer/features/tasks/view/tab-bar/tab-context-menu';
import { refsEqual } from '@shared/core/git/utils';
import type { ActiveFile, TabDescriptor } from '@shared/view-state';
import type {
  TabProvider,
  TabHost,
  TabItemProps,
  TabKindContext,
  TabRendererProps,
  ResolvedTab,
  ResolveContext,
} from '../core/tab-provider';
import { registerTabProvider } from '../core/tab-provider-registry';
import { DiffTabStore } from '../diff-tab-store';
import type { ResolvedDiffTab } from '../pane-store';
import { optionalRefsEqual } from '../pane-store';

// ---------------------------------------------------------------------------
// Registry augmentation — enables typed manager.open('diff', args)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiffOpenArgs {
  activeFile: ActiveFile;
  status?: GitChangeStatus;
  /** When true, opens as a preview tab (replaced on next preview open). */
  preview?: boolean;
}

export interface DiffResolvedData {
  path: string;
  diffGroup: 'disk' | 'staged' | 'git' | 'pr';
  originalRef: GitObjectRef;
  modifiedRef: GitObjectRef | undefined;
  prNumber: number | undefined;
  prBaseOid: string | undefined;
  prHeadOid: string | undefined;
  commitOriginalSha: string | null | undefined;
  commitModifiedSha: string | undefined;
  status: GitChangeStatus | undefined;
}

type DiffDescriptor = Extract<TabDescriptor, { kind: 'diff' }>;

// ---------------------------------------------------------------------------
// UI adapters
// ---------------------------------------------------------------------------

function DiffTabItemAdapter({ tab, host, ctx }: TabItemProps<DiffResolvedData>) {
  return (
    <TabContextMenu tab={tab} host={host} ctx={ctx}>
      <DiffTabItem
        tab={tab as ResolvedDiffTab}
        onSelect={() => host.setActiveTab(tab.tabId)}
        onPin={() => host.pin(tab.tabId)}
        onClose={() => host.requestCloseTab(tab.tabId)}
      />
    </TabContextMenu>
  );
}

function DiffDragPreviewAdapter({ tab }: { tab: ResolvedTab<DiffResolvedData> }) {
  return <DiffTabDragPreview tab={tab as ResolvedDiffTab} />;
}

/**
 * Renders the active diff tab; returns null when no diff tab is active.
 * DiffView mounts/unmounts per active tab (no keepalive needed for diffs).
 */
const DiffTabRenderer = observer(function DiffTabRenderer({ host }: TabRendererProps) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  if (activeTab?.kind !== 'diff') return null;
  const activeTabId = activeTab.tabId;
  const entry = host.findEntry((e): e is DiffTabStore => {
    const s = e as DiffTabStore;
    return s.kind === 'diff' && s.tabId === activeTabId;
  });
  if (!entry) return null;
  return <DiffView tab={entry} />;
});

// ---------------------------------------------------------------------------
// Definition
// ---------------------------------------------------------------------------

export const diffTabProvider: TabProvider<
  DiffTabStore,
  DiffResolvedData,
  DiffDescriptor,
  DiffOpenArgs
> = {
  kind: 'diff',

  resolve(entry: DiffTabStore, _ctx: ResolveContext): DiffResolvedData {
    return {
      path: entry.path,
      diffGroup: entry.diffGroup,
      originalRef: entry.originalRef,
      modifiedRef: entry.modifiedRef,
      prNumber: entry.prNumber,
      prBaseOid: entry.prBaseOid,
      prHeadOid: entry.prHeadOid,
      commitOriginalSha: entry.commitOriginalSha,
      commitModifiedSha: entry.commitModifiedSha,
      status: entry.status,
    };
  },

  serialize(entry: DiffTabStore): DiffDescriptor {
    return {
      kind: 'diff',
      tabId: entry.tabId,
      path: entry.path,
      diffGroup: entry.diffGroup,
      originalRef: entry.originalRef,
      modifiedRef: entry.modifiedRef,
      prNumber: entry.prNumber,
      prBaseOid: entry.prBaseOid,
      prHeadOid: entry.prHeadOid,
      commitOriginalSha: entry.commitOriginalSha,
      commitModifiedSha: entry.commitModifiedSha,
      status: entry.status,
      isPreview: entry.isPreview,
    };
  },

  deserialize(data: DiffDescriptor, _ctx: TabKindContext): DiffTabStore {
    return new DiffTabStore(
      {
        path: data.path,
        type: data.diffGroup === 'disk' ? 'disk' : 'git',
        group: data.diffGroup,
        originalRef: data.originalRef,
        modifiedRef: data.modifiedRef,
        prNumber: data.prNumber,
        prBaseOid: data.prBaseOid,
        prHeadOid: data.prHeadOid,
        commitOriginalSha: data.commitOriginalSha,
        commitModifiedSha: data.commitModifiedSha,
      },
      data.isPreview,
      data.tabId,
      data.status
    );
  },

  TabItem: DiffTabItemAdapter,
  DragPreview: DiffDragPreviewAdapter,
  Renderer: DiffTabRenderer,

  title(tab: ResolvedTab<DiffResolvedData>): string {
    const fileName = tab.path.split('/').pop() ?? 'Untitled';
    return `${fileName} ${diffGroupSuffix(tab.diffGroup)}`;
  },

  open(args: DiffOpenArgs, host: TabHost, _ctx: TabKindContext): void {
    const { activeFile, status } = args;

    const existing = host.findEntry((e): e is DiffTabStore => {
      const entry = e as DiffTabStore;
      if (entry.kind !== 'diff') return false;
      if (entry.path !== activeFile.path || entry.diffGroup !== activeFile.group) return false;
      if (activeFile.group === 'disk' || activeFile.group === 'staged') return true;
      return (
        refsEqual(entry.originalRef, activeFile.originalRef) &&
        optionalRefsEqual(entry.modifiedRef, activeFile.modifiedRef)
      );
    });

    if (args.preview) {
      if (existing) {
        host.setActiveTab(existing.tabId);
        return;
      }
      const previewEntry = host.findEntry(
        (e): e is DiffTabStore =>
          (e as DiffTabStore).kind === 'diff' && (e as DiffTabStore).isPreview
      );
      if (previewEntry) {
        // Replace preview in-place: different tabId but same slot position.
        const tab = new DiffTabStore(activeFile, true, undefined, status);
        host.replaceEntry(previewEntry.tabId, tab, { activate: true });
        return;
      }
      const tab = new DiffTabStore(activeFile, true, undefined, status);
      host.attachEntry(tab, { activate: true });
    } else {
      if (existing) {
        existing.isPreview = false;
        if (status !== undefined) existing.status = status;
        host.setActiveTab(existing.tabId);
        return;
      }
      const tab = new DiffTabStore(activeFile, false, undefined, status);
      host.attachEntry(tab, { activate: true });
    }
  },
};

registerTabProvider(diffTabProvider);
