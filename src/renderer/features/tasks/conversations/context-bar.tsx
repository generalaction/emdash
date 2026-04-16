import { ArrowUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { pastePromptInjection, sendPromptInjection } from '@renderer/lib/pty/prompt-injection';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { buildTaskContextActions, type ContextAction } from './context-actions';

export const ContextBar = observer(function ContextBar() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const task = getRegisteredTaskData(projectId, taskId);
  const { value: reviewPrompt, isSaving: isSavingReviewPrompt } = useAppSettingsKey('reviewPrompt');
  const conversationTabs = provisioned.taskView.conversationTabs;
  const activeConversation = conversationTabs.activeTab;
  const activeSessionId = activeConversation?.session.sessionId;
  const canApplyContext = Boolean(activeSessionId);
  const hasConversation = conversationTabs.tabs.length > 0;

  const actions = useMemo(
    () => buildTaskContextActions(task?.linkedIssue, reviewPrompt),
    [reviewPrompt, task?.linkedIssue]
  );
  const issueAction = actions.find((action) => action.kind === 'linked-issue') ?? null;
  const reviewAction = actions.find((action) => action.kind === 'review-prompt') ?? null;

  if (!hasConversation || (!issueAction && !reviewAction)) return null;

  const applyContext = async (action: ContextAction) => {
    if (!activeSessionId) return;
    if (!action.text) return;

    if (action.behavior === 'send') {
      await sendPromptInjection({
        providerId: activeConversation?.data.providerId,
        text: action.text,
        sendInput: (data) => rpc.pty.sendInput(activeSessionId, data),
      });
    } else {
      await pastePromptInjection({
        providerId: activeConversation?.data.providerId,
        text: action.text,
        sendInput: (data) => rpc.pty.sendInput(activeSessionId, data),
      });
    }
    activeConversation?.session.pty?.terminal.focus();
  };

  return (
    <TooltipProvider>
      <div className="border-t border-border px-2 flex items-center gap-2 h-[41px]">
        {issueAction ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="xs"
                disabled={!canApplyContext}
                onClick={() => void applyContext(issueAction)}
                className="h-6 max-w-full rounded-sm px-2.5 text-xs font-normal"
              >
                {issueAction.provider ? (
                  <ProviderLogo provider={issueAction.provider} className="h-3 w-3" />
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
        {reviewAction ? (
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="xs"
                disabled={!canApplyContext || isSavingReviewPrompt}
                onClick={() => void applyContext(reviewAction)}
                className="h-6 max-w-full rounded-sm px-2.5 text-xs font-normal"
              >
                <span className="max-w-72 truncate">{reviewAction.label}</span>
                <ArrowUp className="size-3 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canApplyContext
                ? 'Send review prompt to the agent'
                : 'Create and select a conversation first'}
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </TooltipProvider>
  );
});
