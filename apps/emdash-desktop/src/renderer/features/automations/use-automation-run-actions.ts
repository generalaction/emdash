import { conversationRegistry } from '@renderer/features/conversations/stores/conversation-registry';
import { toast } from '@renderer/lib/hooks/use-toast';
import type { AutomationRun } from '@shared/core/automations/automation-run';
import { useAutomation, useAutomations } from './use-automations';

const STOPPABLE_RUN_STATUSES = new Set<AutomationRun['status']>([
  'queued',
  'creating_task',
  'launching_task',
  'creating_conversation',
]);

export function useAutomationRunActions(automationId: string, run?: AutomationRun) {
  const { stop } = useAutomations();
  const automation = useAutomation(automationId);
  const projectId = automation?.projectId ?? null;
  const taskId = run?.taskId ?? null;
  const conversations = taskId ? conversationRegistry.get(taskId) : undefined;
  const activeConversation = Array.from(conversations?.conversations.values() ?? []).find(
    (conversation) => conversation.status === 'working' || conversation.status === 'awaiting-input'
  );

  async function stopRun() {
    if (!run) return;
    try {
      await stop.mutateAsync(run.id);
    } catch (error) {
      toast({
        title: 'Failed to stop task run',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    }
  }

  return {
    canStopRun:
      activeConversation !== undefined || STOPPABLE_RUN_STATUSES.has(run?.status ?? 'done'),
    stopRun,
    stopRunPending: stop.isPending,
    stopRunSucceeded: stop.isSuccess,
    projectId,
  };
}
