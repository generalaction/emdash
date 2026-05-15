import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
  ResolvedTab,
} from '../../tabs/tab-manager-store';
import { useWorkspaceViewModel } from '../../task-view-context';
import { ConversationTabDragPreview } from './conversation-tab-item';
import { DiffTabDragPreview } from './diff-tab-item';
import { FileTabDragPreview } from './file-tab-item';

const dragPreviewRenderers = {
  conversation: (tab: ResolvedConversationTab): ReactNode => (
    <ConversationTabDragPreview tab={tab} />
  ),
  file: (tab: ResolvedFileTab): ReactNode => <FileTabDragPreview tab={tab} />,
  diff: (tab: ResolvedDiffTab): ReactNode => <DiffTabDragPreview tab={tab} />,
} satisfies { [K in ResolvedTab['kind']]: (tab: Extract<ResolvedTab, { kind: K }>) => ReactNode };

export const TabDragPreview = observer(function TabDragPreview({ tabId }: { tabId: string }) {
  const { tabGroupManager } = useWorkspaceViewModel();
  const tab = tabGroupManager.groups
    .flatMap((g) => g.tabManager.resolvedTabs)
    .find((t) => t.tabId === tabId);
  if (!tab) return null;

  return dragPreviewRenderers[tab.kind](tab as never);
});
