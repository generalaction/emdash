import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getRegisteredTaskData,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import {
  useConversations,
  useTaskViewContext,
  useWorkspaceViewModel,
} from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { pastePromptInjection } from '@renderer/lib/pty/prompt-injection';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { cn } from '@renderer/utils/utils';
import type { ContextBarAlignment, ContextBarPosition } from '@shared/context-bar-settings';
import { AddContextPopover } from './add-context-popover';
import { buildTaskContextActions, type ContextAction } from './context-actions';

// Base UI highlights menu items on hover via :focus, but the shared ContextMenuRadioItem
// ships shadcn's `bg-accent` token which isn't defined in our theme. Apply the project's
// hover tokens locally so we don't have to touch the shared primitive.
const MENU_ITEM_HOVER = 'focus:bg-background-2 focus:text-foreground';

interface ContextBarProps {
  conversationId: string | undefined;
  position?: Exclude<ContextBarPosition, 'hidden'>;
  alignment?: ContextBarAlignment;
}

export const ContextBar = observer(function ContextBar({
  conversationId,
  position = 'bottom',
  alignment = 'center',
}: ContextBarProps) {
  const { projectId, taskId } = useTaskViewContext();
  const { groupId } = useTabGroupContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const { update: updateInterfaceSettings, isSaving: isSavingInterfaceSettings } =
    useAppSettingsKey('interface');
  const task = getRegisteredTaskData(projectId, taskId);
  const draftComments = getTaskStore(projectId, taskId)?.draftComments;
  const { value: promptLibrary, isSaving: isSavingPromptLibrary } = usePromptLibrary();
  const activeSession = conversationId ? conversations.sessions.get(conversationId) : undefined;
  const activeConversationStore = conversationId
    ? conversations.conversations.get(conversationId)
    : undefined;
  const activeSessionId = activeSession?.sessionId;
  const canApplyContext = Boolean(activeSessionId);
  const hasConversation = conversations.conversations.size > 0;
  const [menuOpen, setMenuOpen] = useState(false);

  const actions = useMemo(
    () => buildTaskContextActions(task?.linkedIssue, draftComments?.comments ?? [], promptLibrary),
    [task?.linkedIssue, draftComments?.comments, promptLibrary]
  );

  if (!draftComments || !hasConversation || actions.length === 0) return null;

  const isActivePane = taskView.tabGroupManager.activeGroupId === groupId;

  const handleApplyAction = async (
    text: string,
    action: ContextAction,
    opts?: { andSend?: boolean }
  ) => {
    if (!activeSessionId || !text) return;

    await pastePromptInjection({
      providerId: activeConversationStore?.data.providerId,
      text,
      forceBracketedPaste: true,
      sendInput: (data) => rpc.pty.sendInput(activeSessionId, data),
    });

    if (action.kind === 'draft-comments') {
      draftComments.consumeAll();
    }

    if (opts?.andSend) {
      await rpc.pty.sendInput(activeSessionId, '\r');
    }

    activeSession?.pty?.terminal.focus();
  };

  const updateContextBarPosition = (nextPosition: ContextBarPosition) => {
    updateInterfaceSettings({ contextBarPosition: nextPosition });
    setMenuOpen(false);
  };

  const updateContextBarAlignment = (nextAlignment: ContextBarAlignment) => {
    updateInterfaceSettings({ contextBarAlignment: nextAlignment });
    setMenuOpen(false);
  };

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger>
        <div
          className={cn(
            'flex w-full items-center bg-background-secondary-1 px-4 py-2',
            alignment === 'left' && 'justify-start',
            alignment === 'center' && 'justify-center',
            alignment === 'right' && 'justify-end'
          )}
        >
          <AddContextPopover
            actions={actions}
            disabled={!canApplyContext || isSavingPromptLibrary}
            isActivePane={isActivePane}
            onApplyAction={handleApplyAction}
            side={position === 'top' ? 'bottom' : 'top'}
          />
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={false}>
        <ContextMenuGroup>
          <ContextMenuLabel>Position</ContextMenuLabel>
          <ContextMenuRadioGroup
            value={position}
            onValueChange={(value) => updateContextBarPosition(value as ContextBarPosition)}
          >
            <ContextMenuRadioItem
              value="top"
              disabled={isSavingInterfaceSettings}
              className={MENU_ITEM_HOVER}
            >
              Top
            </ContextMenuRadioItem>
            <ContextMenuRadioItem
              value="bottom"
              disabled={isSavingInterfaceSettings}
              className={MENU_ITEM_HOVER}
            >
              Bottom
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuGroup>
          <ContextMenuLabel>Alignment</ContextMenuLabel>
          <ContextMenuRadioGroup
            value={alignment}
            onValueChange={(value) => updateContextBarAlignment(value as ContextBarAlignment)}
          >
            <ContextMenuRadioItem
              value="left"
              disabled={isSavingInterfaceSettings}
              className={MENU_ITEM_HOVER}
            >
              Left
            </ContextMenuRadioItem>
            <ContextMenuRadioItem
              value="center"
              disabled={isSavingInterfaceSettings}
              className={MENU_ITEM_HOVER}
            >
              Center
            </ContextMenuRadioItem>
            <ContextMenuRadioItem
              value="right"
              disabled={isSavingInterfaceSettings}
              className={MENU_ITEM_HOVER}
            >
              Right
            </ContextMenuRadioItem>
          </ContextMenuRadioGroup>
        </ContextMenuGroup>
        <ContextMenuSeparator />
        <ContextMenuItem
          disabled={isSavingInterfaceSettings}
          onClick={() => updateContextBarPosition('hidden')}
        >
          Hide context bar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
