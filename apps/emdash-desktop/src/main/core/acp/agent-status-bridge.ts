import {
  sessionSummarySchema,
  type AcpApiContract,
  type SessionSummary,
} from '@emdash/core/runtimes/acp/api';
import type { Unsubscribe } from '@emdash/shared';
import { ReplicaState } from '@emdash/wire';
import type { WireWorker } from '@emdash/wire/worker';
import { z } from 'zod';
import { agentStatusService } from '@main/core/agent-status/agent-status-service';
import type { AcpRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';
import {
  deriveAcpAgentStatusActions,
  projectAcpStatusSnapshot,
  type AcpAgentStatusAction,
} from './agent-status-transition';

type SessionSummaryList = Record<string, SessionSummary>;
export type ConversationCreatedSubscription = (
  handler: (conversation: { id: string }) => void
) => Unsubscribe;

type AcpAgentStatusRuntime = {
  client: AcpRuntimeClient;
  onStateChanged: WireWorker<AcpApiContract>['onStateChanged'];
};

const sessionSummaryListSchema = z.record(z.string(), sessionSummarySchema);

class AcpAgentStatusBridge {
  private readonly summaries = new Map<string, SessionSummary>();
  private workerStateUnsubscribe: Unsubscribe | null = null;
  private conversationCreatedUnsubscribe: Unsubscribe | null = null;
  private replica: ReplicaState<SessionSummaryList> | null = null;
  private attaching = false;
  private bootstrapped = false;
  private runtime: AcpAgentStatusRuntime | undefined;

  initialize(
    onConversationCreated: ConversationCreatedSubscription,
    runtime: AcpAgentStatusRuntime
  ): void {
    this.runtime = runtime;
    this.conversationCreatedUnsubscribe ??= onConversationCreated((conversation) =>
      this.cacheConversationSnapshot(conversation.id)
    );
    void this.attach().catch((error) => {
      log.warn('ACP agent status bridge failed to attach', { error: String(error) });
    });
  }

  dispose(): void {
    this.conversationCreatedUnsubscribe?.();
    this.conversationCreatedUnsubscribe = null;
    this.workerStateUnsubscribe?.();
    this.workerStateUnsubscribe = null;
    this.runtime = undefined;
    this.detach();
  }

  private async attach(): Promise<void> {
    if (this.attaching) return;
    this.attaching = true;
    try {
      this.detach();
      const runtime = this.runtime;
      if (!runtime) throw new Error('ACP agent status runtime has not been configured');
      this.workerStateUnsubscribe = runtime.onStateChanged((state) => {
        if (state.kind !== 'failed' && state.kind !== 'disposed') return;
        void this.resetAll().catch((error) => {
          log.warn('ACP agent status bridge failed to reset statuses on disconnect', {
            error: String(error),
          });
        });
        this.detach();
      });
      const replica = new ReplicaState<SessionSummaryList>(
        runtime.client.sessions.state(undefined, 'list'),
        {
          schema: sessionSummaryListSchema,
          onChange: (summaries) => void this.applySummaries(summaries),
        }
      );
      await replica.ready;
      this.replica = replica;
      this.applySummaries(replica.current(), { bootstrap: true });
      this.bootstrapped = true;
    } finally {
      this.attaching = false;
    }
  }

  private detach(): void {
    this.workerStateUnsubscribe?.();
    this.workerStateUnsubscribe = null;
    const replica = this.replica;
    this.replica = null;
    this.bootstrapped = false;
    if (replica) void replica.dispose();
  }

  private applySummaries(
    nextSummaries: SessionSummaryList,
    options: { bootstrap?: boolean } = {}
  ): void {
    const bootstrap = options.bootstrap ?? !this.bootstrapped;
    const seen = new Set<string>();
    for (const summary of Object.values(nextSummaries)) {
      seen.add(summary.conversationId);
      const actions = bootstrap
        ? [projectAcpStatusSnapshot(summary)].filter(
            (action): action is AcpAgentStatusAction => action !== null
          )
        : deriveAcpAgentStatusActions(this.summaries.get(summary.conversationId), summary);
      this.applyActions(actions, { cache: bootstrap });
      this.summaries.set(summary.conversationId, summary);
    }

    for (const [conversationId, summary] of [...this.summaries]) {
      if (seen.has(conversationId)) continue;
      this.applyActions(deriveAcpAgentStatusActions(summary, undefined));
      this.summaries.delete(conversationId);
    }
  }

  private applyActions(actions: AcpAgentStatusAction[], options: { cache?: boolean } = {}): void {
    for (const action of actions) {
      const pending =
        action.kind === 'event'
          ? options.cache
            ? agentStatusService.cacheSignal(action.event)
            : agentStatusService.applySignal(action.event)
          : agentStatusService.resetToIdle({ conversationId: action.conversationId });
      void pending.catch((error) => this.logApplyError(action, error));
    }
  }

  private async resetAll(): Promise<void> {
    const summaries = [...this.summaries.values()];
    this.summaries.clear();
    await Promise.all(
      summaries.map((summary) =>
        agentStatusService.resetToIdle({ conversationId: summary.conversationId })
      )
    );
  }

  private cacheConversationSnapshot(conversationId: string): void {
    const summary = this.summaries.get(conversationId);
    if (!summary) return;
    const action = projectAcpStatusSnapshot(summary);
    if (action) this.applyActions([action], { cache: true });
  }

  private logApplyError(action: AcpAgentStatusAction, error: unknown): void {
    const conversationId =
      action.kind === 'event' ? action.event.conversationId : action.conversationId;
    log.warn('ACP agent status bridge failed to apply conversation status', {
      conversationId,
      error: String(error),
    });
  }
}

export const acpAgentStatusBridge = new AcpAgentStatusBridge();
