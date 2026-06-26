import type { GitChangeStatus, GitObjectRef } from '@emdash/core/git';
import { observer } from 'mobx-react-lite';
import type {
  TabProvider,
  TabHost,
  TabViewContext,
  TabContentProps,
  ResolvedTab,
  ResolveContext,
} from '@renderer/features/tabs/core/tab-provider';
import { refsEqual } from '@shared/core/git/utils';
import type { ActiveFile, TabDescriptor } from '@shared/view-state';
import type { TaskTabContext } from '../stores/task-tab-context';
import { resolveWorkspacePath } from '../stores/workspace-path';
import { DiffTabItem, DiffTabDragPreview, diffGroupSuffix } from './diff-tab-item';
import { DiffView } from './main-panel/diff-view';
import { DiffTabStore } from './stores/diff-tab-store';

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

function optionalRefsEqual(
  left: GitObjectRef | undefined,
  right: GitObjectRef | undefined
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return refsEqual(left, right);
}

type DiffDescriptor = Extract<TabDescriptor, { kind: 'diff' }>;

// ---------------------------------------------------------------------------
// UI adapters
// ---------------------------------------------------------------------------

/**
 * Renders the active diff view. Visibility when inactive is managed by PaneContent
 * via visibility:hidden + inert, so this component mounts whenever the pane has any tab.
 */
const DiffTabContent = observer(function DiffTabContent({ host }: TabContentProps) {
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
  'diff',
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

  deserialize(data: DiffDescriptor, ctx: TabViewContext): DiffTabStore {
    const filePath =
      data.diffGroup === 'pr'
        ? data.path
        : resolveWorkspacePath((ctx as TaskTabContext).workspacePath, data.path);
    return new DiffTabStore(
      {
        path: filePath,
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

  TabItem: DiffTabItem,
  DragPreview: DiffTabDragPreview,
  Content: DiffTabContent,

  title(tab: ResolvedTab<DiffResolvedData>): string {
    const fileName = tab.path.split('/').pop() ?? 'Untitled';
    return `${fileName} ${diffGroupSuffix(tab.diffGroup)}`;
  },

  open(args: DiffOpenArgs, host: TabHost, _ctx: TabViewContext): void {
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
