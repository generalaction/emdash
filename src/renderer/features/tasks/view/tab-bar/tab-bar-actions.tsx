import { useHotkey } from '@tanstack/react-hotkeys';
import { Columns2, FileSearch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { ShortcutHint } from '@renderer/lib/ui/shortcut-hint';
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { useTabGroupContext } from '../../tabs/tab-group-context';
import { useTaskViewContext, useWorkspaceViewModel } from '../../task-view-context';

export const TabBarActions = observer(function TabBarActions() {
  const taskView = useWorkspaceViewModel();
  const { projectId, taskId, workspaceId } = useTaskViewContext();
  const { groupId, tabManager } = useTabGroupContext();
  const { tabGroupManager } = taskView;
  const showCommandPalette = useShowModal('commandPaletteModal');
  const showCreateConversationModal = useShowModal('createConversationModal');

  const isFocusedPane =
    taskView.focusedRegion === 'main' && tabGroupManager.activeGroupId === groupId;
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

  return (
    <div className="flex h-full shrink-0 items-center px-1">
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="icon-xs"
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
            <MessageSquarePlus className="size-3" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          New Conversations <ShortcutHint settingsKey="newConversation" />
        </TooltipContent>
      </Tooltip>
      <Button
        size="icon-xs"
        variant="ghost"
        onClick={() =>
          showCommandPalette({ projectId, taskId, workspaceId: workspaceId ?? undefined })
        }
        className="flex h-full items-center justify-center px-2 text-foreground-muted hover:text-foreground hover:bg-background-secondary-1/40"
        aria-label="Open files"
        title="Open files"
      >
        <FileSearch className="size-3" />
      </Button>
      {tabGroupManager.groups.length < 3 && (
        <Tooltip>
          <TooltipTrigger>
            <span>
              <Button
                size="icon-xs"
                variant="ghost"
                disabled={!canSplit}
                onClick={() => tabGroupManager.splitRight()}
                aria-label="Split pane right"
              >
                <Columns2 className="size-3" />
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
  );
});
