import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import { useWorkspaceViewModel } from '@renderer/features/tasks/task-view-context';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
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

function makeTabRenderers(tabManager: ReturnType<typeof useTabGroupContext>['tabManager']) {
  return {
    conversation: (tab: ResolvedConversationTab): ReactNode => (
      <ConversationTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.openConversation(tab.conversationId)}
        onClose={() => tabManager.closeTab(tab.tabId)}
      />
    ),
    diff: (tab: ResolvedDiffTab): ReactNode => (
      <DiffTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.pinTab(tab.tabId)}
        onClose={() => tabManager.closeTab(tab.tabId)}
      />
    ),
    file: (tab: ResolvedFileTab): ReactNode => (
      <FileTabItem
        key={tab.tabId}
        tab={tab}
        onSelect={() => tabManager.setActiveTab(tab.tabId)}
        onPin={() => tabManager.pinTab(tab.tabId)}
        onClose={() => tabManager.closeTabWithGuard(tab.tabId)}
      />
    ),
  } satisfies { [K in ResolvedTab['kind']]: (tab: Extract<ResolvedTab, { kind: K }>) => ReactNode };
}

export const TabBar = observer(function TabBar() {
  const taskView = useWorkspaceViewModel();
  const { groupId, tabManager } = useTabGroupContext();
  const { tabGroupManager } = taskView;
  const tabRenderers = makeTabRenderers(tabManager);

  const isFocusedPane =
    taskView.focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  useTabShortcuts(tabManager, { focused: isFocusedPane });

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
