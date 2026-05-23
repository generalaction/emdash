import { useHotkey } from '@tanstack/react-hotkeys';
import { Columns2, FileSearch, MessageSquarePlus } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useAppShortcutsEnabled } from '@renderer/lib/hooks/use-app-shortcuts-enabled';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useShowModal } from '@renderer/lib/modal/modal-provider';
import { Button } from '@renderer/lib/ui/button';
import { BoundShortcut } from '@renderer/lib/ui/shortcut';
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
  const appShortcutsEnabled = useAppShortcutsEnabled();
  const canSplit = tabManager.resolvedTabs.length >= 2 && tabGroupManager.groups.length < 3;

  useHotkey(
    getHotkeyRegistration('splitPane', keyboard),
    (e) => {
      e.preventDefault();
      tabGroupManager.splitRight();
    },
    {
      enabled:
        appShortcutsEnabled &&
        isFocusedPane &&
        canSplit &&
        getEffectiveHotkey('splitPane', keyboard) !== null,
      conflictBehavior: 'allow',
    }
  );

  return (
    <div className="flex h-full shrink-0 items-center px-2">
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
          >
            <MessageSquarePlus className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          New Conversations <BoundShortcut settingsKey="newConversation" variant="badge" />
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() =>
              showCommandPalette({ projectId, taskId, workspaceId: workspaceId ?? undefined })
            }
          >
            <FileSearch className="size-3.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Open File</TooltipContent>
      </Tooltip>
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
                <Columns2 className="size-3.5" />
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {canSplit ? (
              <span className="flex items-center gap-2">
                Move active tab to a new pane
                <BoundShortcut settingsKey="splitPane" variant="badge" />
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
