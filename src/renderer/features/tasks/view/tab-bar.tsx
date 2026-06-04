import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type ReactNode } from 'react';
import {
  closeActiveTabWithConfirm,
  closeTabWithConfirm,
} from '@renderer/features/tasks/tabs/close-tab-with-confirm';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import {
  useConversations,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import type { ConversationManagerStore } from '../conversations/conversation-manager';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
  ResolvedTab,
} from '../tabs/tab-manager-store';
import { ConversationTabItem } from './tab-bar/conversation-tab-item';
import { DiffTabItem } from './tab-bar/diff-tab-item';
import { PaneDropZone } from './tab-bar/draggable-tab';
import { FileTabItem } from './tab-bar/file-tab-item';
import { TabBarActions } from './tab-bar/tab-bar-actions';

function makeTabRenderers(
  tabManager: ReturnType<typeof useTabGroupContext>['tabManager'],
  conversations: ConversationManagerStore
) {
  return {
    conversation: (tab: ResolvedConversationTab): ReactNode => (
      <ConversationTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.openConversation(tab.conversationId)}
        onClose={() => closeTabWithConfirm(tabManager, tab.tabId)}
        onRenameSubmit={(name) => void conversations.renameConversation(tab.conversationId, name)}
      />
    ),
    diff: (tab: ResolvedDiffTab): ReactNode => (
      <DiffTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.pinTab(tab.tabId)}
        onClose={() => closeTabWithConfirm(tabManager, tab.tabId)}
      />
    ),
    file: (tab: ResolvedFileTab): ReactNode => (
      <FileTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.pinTab(tab.tabId)}
        onClose={() => closeTabWithConfirm(tabManager, tab.tabId)}
      />
    ),
  } satisfies { [K in ResolvedTab['kind']]: (tab: Extract<ResolvedTab, { kind: K }>) => ReactNode };
}

export const TabBar = observer(function TabBar() {
  const taskView = useWorkspaceViewModel();
  const { groupId, tabManager } = useTabGroupContext();
  const { tabGroupManager } = taskView;
  const conversations = useConversations();
  const tabRenderers = makeTabRenderers(tabManager, conversations);

  const isFocusedPane =
    taskView.focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  useTabShortcuts(tabManager, {
    focused: isFocusedPane,
    closeActiveTab: () => closeActiveTabWithConfirm(tabManager),
  });

  const resolvedTabs = tabManager.resolvedTabs;

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = tabManager.activeTabId;
    if (!id || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-tabid="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
  }, [tabManager.activeTabId]);

  return (
    <div className="task-tab-bar flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-x-auto">
        {resolvedTabs.map((tab) => tabRenderers[tab.kind](tab as never))}
        <PaneDropZone groupId={groupId} />
      </div>
      <TabBarActions />
    </div>
  );
});
