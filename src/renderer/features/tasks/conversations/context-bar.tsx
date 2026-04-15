import { ArrowUp } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { getRegisteredTaskData } from '@renderer/features/tasks/stores/task-selectors';
import { useProvisionedTask, useTaskViewContext } from '@renderer/features/tasks/task-view-context';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@renderer/lib/ui/tooltip';
import { ProviderLogo } from '../components/issue-selector/issue-selector';
import { buildTaskContextActions, type ContextAction } from './context-actions';

export const ContextBar = observer(function ContextBar() {
  const { projectId, taskId } = useTaskViewContext();
  const provisioned = useProvisionedTask();
  const task = getRegisteredTaskData(projectId, taskId);
  const actions = buildTaskContextActions(task?.linkedIssue);
  const conversationTabs = provisioned.taskView.conversationTabs;
  const activeConversation = conversationTabs.activeTab;
  const activeSessionId = activeConversation?.session.sessionId;
  const canApplyContext = Boolean(activeSessionId);
  const hasConversation = conversationTabs.tabs.length > 0;

  if (!hasConversation || actions.length === 0) return null;

  const applyContext = async (action: ContextAction) => {
    if (!activeSessionId) return;
    const input = action.behavior === 'send' ? `${action.text}\r` : action.text;
    if (!input) return;
    await rpc.pty.sendInput(activeSessionId, input);
    activeConversation?.session.pty?.terminal.focus();
  };

  return (
    <TooltipProvider>
      <div className="border-t border-border p-2 flex items-center gap-2">
        {actions.map((action) => (
          <Tooltip key={action.id}>
            <TooltipTrigger>
              <Button
                variant="outline"
                size="xs"
                disabled={!canApplyContext}
                onClick={() => void applyContext(action)}
                className="h-6 max-w-full rounded-xm px-2.5 text-xs font-normal"
              >
                {action.provider ? (
                  <ProviderLogo provider={action.provider} className="h-3 w-3" />
                ) : null}
                <span className="max-w-72 truncate">{action.label}</span>
                <ArrowUp className="size-3 shrink-0" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {canApplyContext
                ? action.behavior === 'send'
                  ? 'Send context now'
                  : 'Add context to the chat input'
                : 'Create and select a conversation first'}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
});
