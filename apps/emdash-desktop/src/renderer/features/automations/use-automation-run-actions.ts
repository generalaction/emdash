import { useState } from 'react';
import { conversationRegistry } from '@renderer/features/conversations/stores/conversation-registry';
import { getAcpRuntimeClient } from '@renderer/lib/acp/runtime-client';
import { toast } from '@renderer/lib/hooks/use-toast';
import { rpc } from '@renderer/lib/ipc';
import type { AutomationRun } from '@shared/core/automations/automation-run';
import { makePtySessionId } from '@shared/core/pty/ptySessionId';
import { isAutomationConversationRunning } from './automation-run-stop';
import { useAutomation } from './use-automations';

export function useAutomationRunActions(automationId: string) {
  const automation = useAutomation(automationId);
  const [stopPending, setStopPending] = useState(false);

  async function stopTaskRun(run: AutomationRun) {
    const projectId = automation?.projectId;
    const taskId = run.taskId;
    if (!taskId || !projectId || stopPending) return;

    const conversations = conversationRegistry.get(taskId)?.conversations.values();
    const activeConversations = conversations
      ? Array.from(conversations).filter(isAutomationConversationRunning)
      : [];

    setStopPending(true);
    try {
      await Promise.all(
        activeConversations.map(async (conversation) => {
          if (conversation.data.type === 'acp') {
            const client = await getAcpRuntimeClient();
            const result = await client.stopSession({ conversationId: conversation.data.id });
            if (!result.success) throw new Error(formatStopError(result.error));
            return;
          }

          const result = await rpc.pty.stopSession(
            makePtySessionId(projectId, taskId, conversation.data.id)
          );
          if (!result.success) throw new Error(formatStopError(result.error));
        })
      );
    } catch (error) {
      toast({
        title: 'Failed to stop task run',
        description: error instanceof Error ? error.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setStopPending(false);
    }
  }

  return {
    stopTaskRun,
    stopPending,
    projectId: automation?.projectId ?? null,
  };
}

function formatStopError(error: unknown) {
  if (typeof error !== 'object' || error === null) return String(error);
  if ('message' in error && typeof error.message === 'string') return error.message;
  if ('type' in error && typeof error.type === 'string') return error.type;
  return 'Unknown error';
}
