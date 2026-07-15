import { sessionSummarySchema, type SessionSummary } from '@emdash/core/runtimes/acp/api';
import type { Unsubscribe } from '@emdash/shared';
import { ReplicaState } from '@emdash/wire';
import { z } from 'zod';
import { isAppFocused } from '@main/core/agent-status/agent-notification-delivery';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import { acpWorker, getAcpRuntimeClient } from '@main/core/wire-workers/desktop-workers';
import { log } from '@main/lib/logger';
import { deriveAcpAgentStatusActions, type AcpAgentStatusAction } from './agent-status-transition';

type SessionSummaryList = Record<string, SessionSummary>;

const sessionSummaryListSchema = z.record(z.string(), sessionSummarySchema);

class AcpAgentStatusBridge {
  private readonly summaries = new Map<string, SessionSummary>();
  private workerStateUnsubscribe: Unsubscribe | null = null;
  private replica: ReplicaState<SessionSummaryList> | null = null;
  private attaching = false;

  initialize(): void {
    void this.attach().catch((error) => {
      log.warn('ACP agent status bridge failed to attach', { error: String(error) });
    });
  }

  dispose(): void {
    this.workerStateUnsubscribe?.();
    this.workerStateUnsubscribe = null;
    this.detach();
  }

  private async attach(): Promise<void> {
    if (this.attaching) return;
    this.attaching = true;
    try {
      this.detach();
      const acpClient = await getAcpRuntimeClient();
      this.workerStateUnsubscribe = acpWorker.onStateChanged((state) => {
        if (state.kind !== 'failed' && state.kind !== 'disposed') return;
        void this.resetAll().catch((error) => {
          log.warn('ACP agent status bridge failed to reset statuses on disconnect', {
            error: String(error),
          });
        });
        this.detach();
      });
      const replica = new ReplicaState<SessionSummaryList>(
        acpClient.sessions.state(undefined, 'list'),
        {
          schema: sessionSummaryListSchema,
          onChange: (summaries) => void this.applySummaries(summaries),
        }
      );
      await replica.ready;
      this.replica = replica;
      this.applySummaries(replica.current());
    } finally {
      this.attaching = false;
    }
  }

  private detach(): void {
    this.workerStateUnsubscribe?.();
    this.workerStateUnsubscribe = null;
    const replica = this.replica;
    this.replica = null;
    if (replica) void replica.dispose();
  }

  private applySummaries(nextSummaries: SessionSummaryList): void {
    const seen = new Set<string>();
    for (const summary of Object.values(nextSummaries)) {
      seen.add(summary.conversationId);
      this.applyActions(
        deriveAcpAgentStatusActions(this.summaries.get(summary.conversationId), summary)
      );
      this.summaries.set(summary.conversationId, summary);
    }

    for (const [conversationId, summary] of [...this.summaries]) {
      if (seen.has(conversationId)) continue;
      this.applyActions(deriveAcpAgentStatusActions(summary, undefined));
      this.summaries.delete(conversationId);
    }
  }

  private applyActions(actions: AcpAgentStatusAction[]): void {
    for (const action of actions) {
      if (action.kind === 'event') {
        void agentStatusService.applyAgentEvent(action.event, { appFocused: isAppFocused() });
      } else {
        void agentStatusService
          .resetToIdle({
            conversationId: action.conversationId,
            taskId: action.taskId,
            projectId: action.projectId,
          })
          .catch((error) => {
            log.warn('ACP agent status bridge failed to reset conversation status', {
              conversationId: action.conversationId,
              error: String(error),
            });
          });
      }
    }
  }

  private async resetAll(): Promise<void> {
    const summaries = [...this.summaries.values()];
    this.summaries.clear();
    await Promise.all(
      summaries.map((summary) =>
        agentStatusService.resetToIdle({
          conversationId: summary.conversationId,
          projectId: summary.projectId,
          taskId: summary.taskId,
        })
      )
    );
  }
}

export const acpAgentStatusBridge = new AcpAgentStatusBridge();
