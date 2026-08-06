import {
  acpApiContract,
  sessionSummarySchema,
  type AcpApiContract,
  type SessionSummary,
} from '@emdash/core/runtimes/acp/api';
import type { Unsubscribe } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote, whenReady } from '@emdash/wire/state';
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
import { deriveAcpSessionTitleAction, type AcpSessionTitleAction } from './session-title-action';

type SessionSummaryList = Record<string, SessionSummary>;
export type ConversationCreatedSubscription = (
  handler: (conversation: { id: string }) => void
) => Unsubscribe;

type AcpAgentStatusRuntime = {
  client: AcpRuntimeClient;
  onStateChanged: WireWorker<AcpApiContract>['onStateChanged'];
};

type AcpSessionTitleDeps = {
  renameConversation: (conversationId: string, name: string) => Promise<unknown>;
};

const sessionSummaryListSchema = z.record(z.string(), sessionSummarySchema);

class AcpAgentStatusBridge {
  private readonly summaries = new Map<string, SessionSummary>();
  private workerStateUnsubscribe: Unsubscribe | null = null;
  private conversationCreatedUnsubscribe: Unsubscribe | null = null;
  private attachScope: Scope | null = null;
  private attaching = false;
  private runtime: AcpAgentStatusRuntime | undefined;
  private titleDeps: AcpSessionTitleDeps | undefined;

  initialize(
    onConversationCreated: ConversationCreatedSubscription,
    runtime: AcpAgentStatusRuntime,
    deps: AcpSessionTitleDeps
  ): void {
    this.runtime = runtime;
    this.titleDeps = deps;
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
    this.titleDeps = undefined;
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
      const scope = createScope({ label: 'acp-agent-status-bridge' });
      this.attachScope = scope;
      const sessions = remote(acpApiContract.sessions, runtime.client.sessions, {
        scope,
        lingerMs: 15_000,
      });
      const list = sessions(undefined).states.list;
      let first = true;
      let applyChain = Promise.resolve();
      observe(
        list,
        (snapshot) => {
          if (snapshot.status === 'loading') return;
          const summaries = sessionSummaryListSchema.parse(snapshot.value ?? {});
          const bootstrap = first;
          first = false;
          applyChain = applyChain
            .then(() => this.applySummaries(summaries, { bootstrap }))
            .catch((error) => {
              log.warn('ACP agent status bridge failed to apply summaries', {
                error: String(error),
              });
            });
        },
        { scope }
      );
      await whenReady(list, { scope });
      await applyChain;
      if (this.attachScope !== scope) {
        await scope.dispose();
        return;
      }
    } finally {
      this.attaching = false;
    }
  }

  private detach(): void {
    this.workerStateUnsubscribe?.();
    this.workerStateUnsubscribe = null;
    const scope = this.attachScope;
    this.attachScope = null;
    if (scope) void scope.dispose();
  }

  private applySummaries(
    nextSummaries: SessionSummaryList,
    options: { bootstrap?: boolean } = {}
  ): void {
    const bootstrap = options.bootstrap ?? false;
    const seen = new Set<string>();
    for (const summary of Object.values(nextSummaries)) {
      seen.add(summary.conversationId);
      const previous = this.summaries.get(summary.conversationId);
      const actions = bootstrap
        ? [projectAcpStatusSnapshot(summary)].filter(
            (action): action is AcpAgentStatusAction => action !== null
          )
        : deriveAcpAgentStatusActions(previous, summary);
      this.applyActions(actions, { cache: bootstrap });
      if (!bootstrap) {
        const titleAction = deriveAcpSessionTitleAction(previous, summary);
        if (titleAction) this.applyTitleAction(titleAction);
      }
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

  private applyTitleAction(action: AcpSessionTitleAction): void {
    const pending = this.titleDeps?.renameConversation(action.conversationId, action.title);
    if (!pending) {
      log.warn('ACP session title bridge missing rename dependency', {
        conversationId: action.conversationId,
      });
      return;
    }
    void pending.catch((error) => {
      log.warn('ACP session title apply failed', {
        conversationId: action.conversationId,
        error: String(error),
      });
    });
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
