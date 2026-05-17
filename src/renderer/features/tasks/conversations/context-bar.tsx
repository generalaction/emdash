import { ArrowUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { usePromptLibrary } from '@renderer/features/library/prompts/use-prompt-library';
import {
  getRegisteredTaskData,
  getTaskStore,
} from '@renderer/features/tasks/stores/task-selectors';
import { useTabGroupContext } from '@renderer/features/tasks/tabs/tab-group-context';
import { useConversations, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { pastePromptInjection } from '@renderer/lib/pty/prompt-injection';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { CommentsPopover } from './comments-popover';
import {
  buildLinkedIssueContextAction,
  buildTaskContextActions,
  type ContextAction,
} from './context-actions';
import { PromptActionsMenu } from './prompt-actions-menu';
import { refreshLinkedIssueContext } from './refresh-linked-issue-context';

export const ContextBar = observer(function ContextBar() {
  const { projectId, taskId } = useTaskViewContext();
  const conversations = useConversations();
  const task = getRegisteredTaskData(projectId, taskId);
  const draftComments = getTaskStore(projectId, taskId)?.draftComments;
  const { value: promptLibrary, isSaving: isSavingPromptLibrary } = usePromptLibrary();
  const conversationStore = conversations;
  const { tabManager } = useTabGroupContext();
  const activeConversation = tabManager.activeConversation;
  const activeSessionId = activeConversation
    ? conversations.sessions.get(activeConversation.data.id)?.sessionId
    : undefined;
  const canApplyContext = Boolean(activeSessionId);
  const hasConversation = conversationStore.conversations.size > 0;
  const formattedDraftComments = draftComments?.formattedForAgent ?? '';

  const actions = useMemo(
    () =>
      buildTaskContextActions(
        task?.linkedIssue,
        {
          count: draftComments?.count ?? 0,
          formattedComments: formattedDraftComments,
        },
        promptLibrary
      ),
    [promptLibrary, task?.linkedIssue, draftComments?.count, formattedDraftComments]
  );
  const issueAction = actions.find((action) => action.kind === 'linked-issue') ?? null;
  const promptActions = actions.filter((action) => action.kind === 'prompt');
  const draftCommentsAction = actions.find((action) => action.kind === 'draft-comments') ?? null;

  if (
    !draftComments ||
    !hasConversation ||
    (!issueAction && !draftCommentsAction && promptActions.length === 0)
  )
    return null;

  const applyContext = async (action: ContextAction) => {
    if (!activeSessionId) return;

    let text = action.text;
    const linkedIssue = task?.linkedIssue;
    if (action.kind === 'linked-issue' && linkedIssue?.provider === 'linear') {
      const refreshedIssue = await refreshLinkedIssueContext(linkedIssue, projectId);
      const refreshedAction = buildLinkedIssueContextAction(refreshedIssue);
      text = refreshedAction?.text ?? text;
    }

    if (!text) return;

    await pastePromptInjection({
      providerId: activeConversation?.data.providerId,
      text,
      forceBracketedPaste: true,
      sendInput: (data) => rpc.pty.sendInput(activeSessionId, data),
    });

    conversations.sessions.get(activeConversation?.data.id ?? '')?.pty?.terminal.focus();
  };

  return (
    <TooltipProvider>
      <div className="px-2 pb-4 flex justify-center items-center gap-2 bg-background-secondary-1 w-full">
        <div className="flex max-w-full flex-wrap items-center gap-1 rounded-lg border bg-background-2 p-1">
          <PromptActionsMenu
            actions={promptActions}
            disabled={!canApplyContext || isSavingPromptLibrary}
            disabledTooltip="Create and select a conversation first"
            actionTooltip="Add a prompt to the chat input"
            onActionClick={(action) => void applyContext(action)}
          />
          {issueAction ? (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!canApplyContext}
                  onClick={() => void applyContext(issueAction)}
                  className="h-7 max-w-full rounded-md bg-background-1 px-2 text-xs font-normal hover:bg-background-1/80"
                >
                  {issueAction.provider ? (
                    <ProviderLogo provider={issueAction.provider} className="h-3.5 w-3.5" />
                  ) : null}
                  <span className="max-w-72 truncate">{issueAction.label}</span>
                  <ArrowUp className="size-3 shrink-0" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {canApplyContext
                  ? 'Add issue context to the chat input'
                  : 'Create and select a conversation first'}
              </TooltipContent>
            </Tooltip>
          ) : null}
          {draftCommentsAction ? (
            <CommentsPopover
              comments={draftComments.comments}
              canApplyContext={canApplyContext}
              onApply={() => {
                void applyContext(draftCommentsAction).then(() => draftComments.consumeAll());
              }}
              onDelete={draftComments.deleteComment}
            />
          ) : null}
        </div>
      </div>
    </TooltipProvider>
  );
});
