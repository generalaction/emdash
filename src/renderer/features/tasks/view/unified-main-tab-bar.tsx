import { useHotkey } from '@tanstack/react-hotkeys';
import { Columns2, FileSearch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, type ReactNode } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import {
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTabShortcuts } from '@renderer/lib/hooks/useTabShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import type {
  ResolvedConversationTab,
  ResolvedDiffTab,
  ResolvedFileTab,
  ResolvedTab,
} from '../tabs/tab-manager-store';
import { PaneDropZone } from './draggable-tab';
import { ConversationTabItem } from './tab-items/conversation-tab-item';
import { DiffTabItem } from './tab-items/diff-tab-item';
import { FileTabItem } from './tab-items/file-tab-item';

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

export const UnifiedMainTabBar = observer(function UnifiedMainTabBar() {
  const taskView = useWorkspaceViewModel();
  const { projectId, taskId, workspaceId } = useTaskViewContext();
  const { groupId, tabManager } = useTabGroupContext();
  const { tabGroupManager } = taskView;
  const tabRenderers = makeTabRenderers(tabManager);
  const showCommandPalette = useShowModal('commandPaletteModal');
  const showCreateConversationModal = useShowModal('createConversationModal');

  const isFocusedPane =
    taskView.focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;

  useTabShortcuts(tabManager, { focused: isFocusedPane });

  const { value: keyboard } = useAppSettingsKey('keyboard');
  const canSplit = tabManager.resolvedTabs.length >= 2 && tabGroupManager.groups.length < 3;
  useHotkey(
    getHotkeyRegistration('splitPane', keyboard),
    (e) => {
      e.preventDefault();
      tabGroupManager.splitRight();
    },
    {
      enabled: isFocusedPane && canSplit && getEffectiveHotkey('splitPane', keyboard) !== null,
      conflictBehavior: 'allow',
    }
  );

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
    <div className="flex h-[41px] shrink-0 items-center justify-between border-b border-border bg-background-secondary">
      <div ref={scrollContainerRef} className="flex h-full w-full overflow-x-auto">
        {resolvedTabs.map((tab) => tabRenderers[tab.kind](tab as never))}
        <PaneDropZone groupId={groupId} />
      </div>
      <div className="flex h-full shrink-0 items-center px-1">
        <Tooltip>
          <TooltipTrigger>
            <Button
              size="icon-sm"
              variant="ghost"
              onClick={() =>
                showCreateConversationModal({
                  projectId,
                  taskId,
                  onSuccess: ({ conversationId }) => tabManager.openConversation(conversationId),
                })
              }
              aria-label="New conversation"
              title="New conversation"
            >
              <MessageSquarePlus className="size-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            New Conversations <ShortcutHint settingsKey="newConversation" />
          </TooltipContent>
        </Tooltip>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() =>
            showCommandPalette({ projectId, taskId, workspaceId: workspaceId ?? undefined })
          }
          className="flex h-full items-center justify-center px-2 text-foreground-muted hover:text-foreground hover:bg-background-secondary-1/40"
          aria-label="Open files"
          title="Open files"
        >
          <FileSearch className="size-4" />
        </Button>
        {tabGroupManager.groups.length < 3 && (
          <Tooltip>
            <TooltipTrigger>
              <span>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  disabled={!canSplit}
                  onClick={() => tabGroupManager.splitRight()}
                  aria-label="Split pane right"
                >
                  <Columns2 className="size-4" />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {canSplit ? (
                <span className="flex items-center gap-2">
                  Move active tab to a new pane
                  <ShortcutHint settingsKey="splitPane" />
                </span>
              ) : (
                'Open at least 2 tabs to split this pane'
              )}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
    </div>
  );
});
