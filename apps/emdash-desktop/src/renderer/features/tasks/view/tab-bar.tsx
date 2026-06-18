import { ChevronLeft, ChevronRight } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
  ResolvedBrowserTab,
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
  ResolvedTab,
} from '../tabs/tab-manager-store';
import { BrowserTabItem } from './tab-bar/browser-tab-item';
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
    browser: (tab: ResolvedBrowserTab): ReactNode => (
      <BrowserTabItem
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
  const [scrollEdges, setScrollEdges] = useState({ left: false, right: false });

  const updateScrollEdges = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    const maxScrollLeft = el.scrollWidth - el.clientWidth;
    setScrollEdges({
      left: el.scrollLeft > 0,
      right: el.scrollLeft < maxScrollLeft - 1,
    });
  }, []);

  const scrollTabsBy = useCallback((direction: -1 | 1) => {
    const el = scrollContainerRef.current;
    if (!el) return;

    el.scrollBy({ left: direction * Math.round(el.clientWidth * 0.7), behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;

    updateScrollEdges();
    el.addEventListener('scroll', updateScrollEdges, { passive: true });

    const resizeObserver = new ResizeObserver(updateScrollEdges);
    resizeObserver.observe(el);

    return () => {
      el.removeEventListener('scroll', updateScrollEdges);
      resizeObserver.disconnect();
    };
  }, [resolvedTabs.length, updateScrollEdges]);

  useEffect(() => {
    const id = tabManager.activeTabId;
    if (!id || !scrollContainerRef.current) return;
    const el = scrollContainerRef.current.querySelector<HTMLElement>(
      `[data-tabid="${CSS.escape(id)}"]`
    );
    el?.scrollIntoView({ behavior: 'instant', inline: 'nearest', block: 'nearest' });
    updateScrollEdges();
  }, [tabManager.activeTabId, updateScrollEdges]);

  return (
    <div className="task-tab-bar flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div className="relative h-full min-w-0 flex-1">
        <div ref={scrollContainerRef} className="flex h-full w-full scrollbar-none overflow-x-auto">
          {resolvedTabs.map((tab) => tabRenderers[tab.kind](tab as never))}
          <PaneDropZone groupId={groupId} />
        </div>
        {scrollEdges.left && (
          <div className="pointer-events-none absolute inset-y-0 left-0 flex w-7 items-center justify-start bg-linear-to-r from-background-secondary via-background-secondary/90 to-transparent pl-1 text-foreground-muted">
            <button
              type="button"
              className="pointer-events-auto rounded-sm hover:text-foreground"
              aria-label="Scroll tabs left"
              onClick={() => scrollTabsBy(-1)}
            >
              <ChevronLeft className="size-4" />
            </button>
          </div>
        )}
        {scrollEdges.right && (
          <div className="pointer-events-none absolute inset-y-0 right-0 flex w-7 items-center justify-end bg-linear-to-l from-background-secondary via-background-secondary/90 to-transparent pr-1 text-foreground-muted">
            <button
              type="button"
              className="pointer-events-auto rounded-sm hover:text-foreground"
              aria-label="Scroll tabs right"
              onClick={() => scrollTabsBy(1)}
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        )}
      </div>
      <TabBarActions />
    </div>
  );
});
