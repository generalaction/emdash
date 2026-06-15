import { MessageSquare } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactNode } from 'react';
import type {
  ResolvedBrowserTab,
  ResolvedChatTab,
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
  ResolvedTab,
} from '../../tabs/tab-manager-store';
import { useWorkspaceViewModel } from '../../task-view-context';
import { BrowserTabDragPreview } from './browser-tab-item';
import { ConversationTabDragPreview } from './conversation-tab-item';
import { DiffTabDragPreview } from './diff-tab-item';
import { FileTabDragPreview } from './file-tab-item';
import { TabDragPreviewShell } from './tab-item-shell';

function ChatTabDragPreview({ tab }: { tab: ResolvedChatTab }) {
  return (
    <TabDragPreviewShell>
      <MessageSquare className="size-4 shrink-0" />
      <span className="max-w-[200px] truncate">{tab.store.data.title}</span>
    </TabDragPreviewShell>
  );
}

const dragPreviewRenderers = {
  chat: (tab: ResolvedChatTab): ReactNode => <ChatTabDragPreview tab={tab} />,
  browser: (tab: ResolvedBrowserTab): ReactNode => <BrowserTabDragPreview tab={tab} />,
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
