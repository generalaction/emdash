import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { usePaneContext } from '@renderer/features/tabs/pane-context';
import {
  getRegisteredTaskData,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
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
  ContextMenuItem,
  ContextMenuTrigger,
} from '@renderer/lib/ui/context-menu';
import { captureTelemetry } from '@renderer/utils/telemetryClient';
import { AddContextPopover } from './add-context-popover';
import { buildTaskContextActions, type ContextAction } from './context-actions';

interface ContextBarProps {
  conversationId: string | undefined;
  hideTrigger?: boolean;
}

export const ContextBar = observer(function ContextBar({
  conversationId,
  hideTrigger = false,
}: ContextBarProps) {
  const { projectId, taskId } = useTaskViewContext();
  const { paneId } = usePaneContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const { update: updateInterfaceSettings, isSaving: isSavingInterfaceSettings } =
    useAppSettingsKey('interface');
  const task = getRegisteredTaskData(projectId, taskId);
  const taskStore = getTaskStore(projectId, taskId);
  const draftComments = taskStore?.draftComments;
  const browserAnnotations = taskStore?.browserAnnotations;
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
    () =>
      buildTaskContextActions(
        task?.linkedIssue,
        draftComments?.comments ?? [],
        browserAnnotations?.annotations ?? [],
        promptLibrary
      ),
    [task?.linkedIssue, draftComments?.comments, browserAnnotations?.annotations, promptLibrary]
  );

  const isActivePane = taskView.paneLayout.activePaneId === paneId;
  const hasVisibleContextBar = Boolean(draftComments && hasConversation && actions.length > 0);
  const popoverActions = canApplyContext ? actions : [];

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

    if (opts?.andSend) {
      await rpc.pty.sendInput(activeSessionId, '\r');
    }

    if (action.kind === 'draft-comments') {
      draftComments?.consumeAll();
    }
    if (action.kind === 'browser-annotations') {
      captureTelemetry('browser_annotations_assigned', {
        annotation_count: action.annotationCount,
        page_count: action.pageCount,
        and_send: Boolean(opts?.andSend),
        provider: activeConversationStore?.data.providerId ?? null,
      });
      browserAnnotations?.consumePending();
    }

    activeSession?.pty?.terminal.focus();
  };

  const hideContextBar = () => {
    updateInterfaceSettings({ hideContextBar: true });
    setMenuOpen(false);
  };

  const contextPopover = (
    <AddContextPopover
      actions={hideTrigger ? popoverActions : actions}
      disabled={!canApplyContext || isSavingPromptLibrary}
      emptyMessage={canApplyContext ? undefined : 'No active sessions'}
      hideTrigger={hideTrigger}
      hotkeyEnabled={hideTrigger ? true : undefined}
      isActivePane={isActivePane}
      onApplyAction={handleApplyAction}
      side="top"
    />
  );

  if (hideTrigger) {
    return <div className="relative h-0 w-full overflow-visible">{contextPopover}</div>;
  }

  if (!hasVisibleContextBar) return null;

  return (
    <ContextMenu open={menuOpen} onOpenChange={setMenuOpen}>
      <ContextMenuTrigger>
        <div className="flex w-full items-center justify-center bg-background-secondary-1 px-4 pb-2">
          {contextPopover}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent finalFocus={false}>
        <ContextMenuItem disabled={isSavingInterfaceSettings} onClick={hideContextBar}>
          Hide context bar
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
