import type { SessionSummary, StopReason } from '@emdash/core/acp';
import type { AgentEvent } from '@shared/core/agents/agentEvents';

const normalStopReasons = new Set<StopReason>([
  'end_turn',
  'max_tokens',
  'max_turn_requests',
  'refusal',
]);

export type AcpAgentStatusAction =
  | { kind: 'event'; event: AgentEvent }
  | { kind: 'reset'; conversationId: string; projectId: string; taskId: string };

function isBusy(summary: SessionSummary | undefined): boolean {
  return summary !== undefined && (summary.isGenerating || summary.queuedPromptCount > 0);
}

function eventBase(summary: SessionSummary): Omit<AgentEvent, 'type' | 'payload'> {
  return {
    source: 'input',
    providerId: summary.providerId,
    projectId: summary.projectId,
    taskId: summary.taskId,
    conversationId: summary.conversationId,
    timestamp: Date.now(),
  };
}

export function deriveAcpAgentStatusActions(
  previous: SessionSummary | undefined,
  next: SessionSummary | undefined
): AcpAgentStatusAction[] {
  if (!next) {
    if (!previous) return [];
    return [
      {
        kind: 'reset',
        conversationId: previous.conversationId,
        projectId: previous.projectId,
        taskId: previous.taskId,
      },
    ];
  }

  if (next.lifecycle === 'closed') {
    return [
      {
        kind: 'reset',
        conversationId: next.conversationId,
        projectId: next.projectId,
        taskId: next.taskId,
      },
    ];
  }

  const actions: AcpAgentStatusAction[] = [];
  const wasBusy = isBusy(previous);
  const nowBusy = isBusy(next);
  const previousPendingPermissionCount = previous?.pendingPermissionCount ?? 0;
  const permissionAppeared =
    previousPendingPermissionCount === 0 && next.pendingPermissionCount > 0;

  if (!wasBusy && nowBusy && !permissionAppeared) {
    actions.push({
      kind: 'event',
      event: { ...eventBase(next), type: 'start', payload: {} },
    });
  }

  if (permissionAppeared) {
    actions.push({
      kind: 'event',
      event: {
        ...eventBase(next),
        type: 'notification',
        payload: { notificationType: 'permission_prompt' },
      },
    });
  }

  if (wasBusy && !nowBusy && next.pendingPermissionCount === 0) {
    if (next.lastStopReason === 'cancelled') {
      actions.push({
        kind: 'reset',
        conversationId: next.conversationId,
        projectId: next.projectId,
        taskId: next.taskId,
      });
    } else if (next.lastStopReason !== null && normalStopReasons.has(next.lastStopReason)) {
      actions.push({
        kind: 'event',
        event: { ...eventBase(next), type: 'stop', payload: {} },
      });
    }
  }

  return actions;
}
