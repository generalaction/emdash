import { ArrowUp, FileSearch } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { usePromptTemplates } from '@renderer/features/settings/use-prompt-templates';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { pastePromptInjection } from '@renderer/lib/pty/prompt-injection';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { CommentsPopover } from './comments-popover';
import { buildTaskContextActions, type ContextAction } from './context-actions';

export const ContextBar = observer(function ContextBar() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const task = getRegisteredTaskData(projectId, taskId);
  const { templates, isLoading: isLoadingTemplates } = usePromptTemplates();
  const conversationTabs = provisioned.taskView.conversationTabs;
  const conversationStore = provisioned.conversations;
  const draftComments = provisioned.draftComments;
  const activeConversation = conversationTabs.activeTab;
  const activeSessionId = activeConversation?.session.sessionId;
  const canApplyContext = Boolean(activeSessionId);
  const hasConversation = conversationStore.conversations.size > 0;
  const formattedDraftComments = draftComments.formattedForAgent;

  const actions = useMemo(
    () =>
      buildTaskContextActions(task?.linkedIssue, templates, {
        count: draftComments.count,
        formattedComments: formattedDraftComments,
      }),
    [templates, task?.linkedIssue, draftComments.count, formattedDraftComments]
  );
  const issueAction = actions.find((action) => action.kind === 'linked-issue') ?? null;
  const draftCommentsAction = actions.find((action) => action.kind === 'draft-comments') ?? null;
  const templateActions = actions.filter((action) => action.kind === 'prompt-template');

  if (!hasConversation || (!issueAction && !draftCommentsAction && templateActions.length === 0))
    return null;

  const applyContext = async (action: ContextAction) => {
    if (!activeSessionId) return;
    if (!action.text) return;

    await pastePromptInjection({
      providerId: activeConversation?.data.providerId,
      text: action.text,
      sendInput: (data) => rpc.pty.sendInput(activeSessionId, data),
    });

    activeConversation?.session.pty?.terminal.focus();
  };

  return (
    <TooltipProvider>
      <div className="border-t border-border px-2 flex items-center gap-2 h-[41px]">
        {templateActions.map((action) => (
          <Tooltip key={action.id}>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="sm"
                disabled={!canApplyContext || isLoadingTemplates}
                onClick={() => void applyContext(action)}
                className="h-7 max-w-full rounded-md bg-background-1 px-2 text-xs font-normal hover:bg-background-1/80"
              >
                <FileSearch className="size-3.5 shrink-0" />
                <span className="max-w-72 truncate">{action.label}</span>
                <ArrowUp className="size-3 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canApplyContext
                ? `Add '${action.label}' to the chat input`
                : 'Create and select a conversation first'}
            </TooltipContent>
          </Tooltip>
        ))}
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
    </TooltipProvider>
  );
});
