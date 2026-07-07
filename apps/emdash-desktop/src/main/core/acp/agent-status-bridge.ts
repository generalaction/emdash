import { acpLiveTopics, sessionSummarySchema, type SessionSummary } from '@emdash/core/acp';
import { LiveModelClient, type LiveSnapshot, type LiveUpdate } from '@emdash/core/live';
import type { Unsubscribe } from '@emdash/shared';
import { z } from 'zod';
import { agentHookService } from '@main/core/agent-hooks/agent-hook-service';
import { isAppFocused } from '@main/core/agent-hooks/notification';
import { log } from '@main/lib/logger';
import { deriveAcpAgentStatusActions, type AcpAgentStatusAction } from './agent-status-transition';
import { acpWire } from './controller';
import { acpRuntimeProcessHost } from './runtime-process/host';

type SessionSummaryList = Record<string, SessionSummary>;

const sessionSummaryListSchema = z.record(z.string(), sessionSummarySchema);

class AcpAgentStatusBridge {
  private readonly summaries = new Map<string, SessionSummary>();
  private startedUnsubscribe: Unsubscribe | null = null;
  private wireUnsubscribe: Unsubscribe | null = null;
  private attaching = false;

  initialize(): void {
    this.startedUnsubscribe = acpRuntimeProcessHost.onStarted(() => {
      void this.attach().catch((error) => {
        log.warn('ACP agent status bridge failed to attach', { error: String(error) });
      });
    });
  }

  dispose(): void {
    this.startedUnsubscribe?.();
    this.startedUnsubscribe = null;
    this.detach();
  }

  private async attach(): Promise<void> {
    if (this.attaching) return;
    this.attaching = true;
    try {
      this.detach();

      const topic = acpLiveTopics.sessionStateList.topic(undefined);
      const client = new LiveModelClient<SessionSummaryList>(
        sessionSummaryListSchema,
        () => acpWire.live.snapshot(topic) as Promise<LiveSnapshot<SessionSummaryList>>,
        (summaries) => void this.applySummaries(summaries)
      );
      const buffer: LiveUpdate[] = [];
      let seeded = false;
      let detachLive: Unsubscribe | null = null;
      let detachWire: Unsubscribe | null = null;

      try {
        detachLive = await acpWire.live.attach(topic, (update) => {
          if (seeded) {
            client.applyUpdate(update);
          } else {
            buffer.push(update);
          }
        });
        detachWire = acpWire.onDisconnect(() => {
          void this.resetAll().catch((error) => {
            log.warn('ACP agent status bridge failed to reset statuses on disconnect', {
              error: String(error),
            });
          });
          this.detach();
        });

        client.seed((await acpWire.live.snapshot(topic)) as LiveSnapshot<SessionSummaryList>);
        seeded = true;
        for (const update of buffer) {
          client.applyUpdate(update);
        }

        this.wireUnsubscribe = () => {
          detachLive?.();
          detachWire?.();
        };
      } catch (error) {
        detachLive?.();
        detachWire?.();
        throw error;
      }
    } finally {
      this.attaching = false;
    }
  }

  private detach(): void {
    this.wireUnsubscribe?.();
    this.wireUnsubscribe = null;
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
        agentHookService.emitAgentEvent(action.event, isAppFocused());
      } else {
        void agentHookService
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
        agentHookService.resetToIdle({
          conversationId: summary.conversationId,
          projectId: summary.projectId,
          taskId: summary.taskId,
        })
      )
    );
  }
}

export const acpAgentStatusBridge = new AcpAgentStatusBridge();
