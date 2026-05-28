import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
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
import { AddContextPopover } from './add-context-popover';
import { buildTaskContextActions, type ContextAction } from './context-actions';

interface ContextBarProps {
  conversationId: string | undefined;
}

export const ContextBar = observer(function ContextBar({ conversationId }: ContextBarProps) {
  const { projectId, taskId } = useTaskViewContext();
  const { groupId } = useTabGroupContext();
  const taskView = useWorkspaceViewModel();
  const conversations = useConversations();
  const task = getRegisteredTaskData(projectId, taskId);
  const draftComments = getTaskStore(projectId, taskId)?.draftComments;
  const { value: promptLibrary, isSaving: isSavingPromptLibrary } = usePromptLibrary();
  const activeSession = conversations.getSession(conversationId);
  const activeConversationStore = conversationId
    ? conversations.conversations.get(conversationId)
    : undefined;
  const activeSessionId = activeSession?.sessionId;
  const canApplyContext = Boolean(activeSessionId);
  const hasConversation = conversations.conversations.size > 0;

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

  return (
    <div className="flex w-full items-center justify-center bg-background-secondary-1 px-4 pb-2">
      <AddContextPopover
        actions={actions}
        disabled={!canApplyContext || isSavingPromptLibrary}
        isActivePane={isActivePane}
        onApplyAction={handleApplyAction}
      />
    </div>
  );
});
