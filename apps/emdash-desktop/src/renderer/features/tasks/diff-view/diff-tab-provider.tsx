import type { GitChangeStatus, GitObjectRef } from '@emdash/core/git';
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
import { DiffTabItem, DiffTabDragPreview } from './diff-tab-item';
import { DiffView } from './main-panel/diff-view';
import type { DiffPayload } from './stores/diff-tab-resource';
import { DiffTabResource } from './stores/diff-tab-resource';

// ---------------------------------------------------------------------------
// Open args
// ---------------------------------------------------------------------------

export interface DiffOpenArgs {
  activeFile: ActiveFile;
  status?: GitChangeStatus;
  /** When true, opens as a preview tab (replaced on next preview open). */
  preview?: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function refKey(ref: GitObjectRef): string {
  switch (ref.kind) {
    case 'branch':
      return `branch:${ref.branch.type === 'remote' ? `${ref.branch.remote.name}/${ref.branch.branch}` : ref.branch.branch}`;
    case 'commit':
      return `commit:${ref.sha}`;
    case 'tag':
      return `tag:${ref.name}`;
  }
}

function diffResourceKey(payload: DiffPayload): string {
  const base = `${payload.path}|${payload.diffGroup}`;
  if (payload.diffGroup === 'disk' || payload.diffGroup === 'staged') return base;
  const origKey = refKey(payload.originalRef);
  const modKey = payload.modifiedRef ? refKey(payload.modifiedRef) : '';
  return `${base}|${origKey}|${modKey}`;
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

// ---------------------------------------------------------------------------
// Content component
// ---------------------------------------------------------------------------

const DiffTabContent = observer(function DiffTabContent({ host }: TabContentProps) {
  const activeTab = host.resolvedTabs.find((t) => t.isActive);
  if (activeTab?.kind !== 'diff') return null;
  return <DiffView tab={activeTab.resource as DiffTabResource} />;
});

// ---------------------------------------------------------------------------
// Provider definition
// ---------------------------------------------------------------------------

export const diffTabProvider: TabProvider<'diff', DiffPayload, DiffTabResource, DiffOpenArgs> =
  createTabProvider({
    kind: 'diff',

    resourceKey: diffResourceKey,

    onBeforeOpen(args: DiffOpenArgs): DiffPayload | null {
      return activeFileToDiffPayload(args.activeFile, args.status);
    },

    initialize(
      entry: TabEntry<DiffPayload>,
      handle: TabHandle,
      _ctx: TabViewContext
    ): DiffTabResource {
      void handle;
      return new DiffTabResource(entry.tabId, entry.payload);
    },

    dispose(_entry: TabEntry<DiffPayload>, resource: DiffTabResource): void {
      resource.dispose();
    },

    /**
     * Called when a stable open targets an already-open diff tab.
     * Update the status field in-place (e.g. disk→staged transition).
     */
    onRetarget(
      _entry: TabEntry<DiffPayload>,
      resource: DiffTabResource,
      newPayload: DiffPayload
    ): void {
      if (newPayload.status !== undefined) {
        resource.updateStatus(newPayload.status);
      }
    },

    TabItem: DiffTabItem,
    DragPreview: DiffTabDragPreview,
    Content: DiffTabContent,

    title(entry: TabEntry<DiffPayload>): string {
      const fileName = entry.payload.path.split('/').pop() ?? 'Untitled';
      const suffix = diffGroupSuffix(entry.payload.diffGroup);
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
