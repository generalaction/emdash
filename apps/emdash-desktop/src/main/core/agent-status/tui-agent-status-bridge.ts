import {
  tuiAgentsContract,
  tuiAgentStateListSchema,
  tuiSessionListSchema,
  type TuiAgentState,
  type TuiAgentStateList,
  type TuiAgentsContract,
  type TuiSessionList,
  type TuiSessionState,
} from '@emdash/core/runtimes/tui-agents/api';
import type { Unsubscribe } from '@emdash/shared';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote, whenReady } from '@emdash/wire';
import type { WireWorker } from '@emdash/wire/worker';
import type { ConversationEvent } from '@core/primitives/conversations/api';
import type { TuiAgentsRuntimeClient } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';
import { agentStatusService } from './agent-status-service';
import {
  eventFromTuiAgentState,
  shouldApplyAgentStateTransition,
} from './tui-agent-status-transition';

type TuiAgentStatusBridgeDependencies = {
  client: TuiAgentsRuntimeClient;
  onStateChanged: WireWorker<TuiAgentsContract>['onStateChanged'];
  publishConversationEvent(event: ConversationEvent): void;
};

class TuiAgentStatusBridge {
  private readonly agentStates = new Map<string, TuiAgentState>();
  private readonly sessions = new Map<string, TuiSessionState>();
  private workerStateUnsubscribe: Unsubscribe | null = null;
  private attachScope: Scope | null = null;
  private attaching = false;
  private dependencies: TuiAgentStatusBridgeDependencies | undefined;

  initialize(dependencies: TuiAgentStatusBridgeDependencies): void {
    this.dependencies = dependencies;
    void this.attach().catch((error) => {
      log.warn('TUI agent status bridge failed to attach', { error: String(error) });
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
      const dependencies = this.dependencies;
      if (!dependencies) throw new Error('TUI agent status runtime has not been configured');
      this.workerStateUnsubscribe = dependencies.onStateChanged((state) => {
        if (state.kind !== 'failed' && state.kind !== 'disposed') return;
        this.detach();
      });

      const scope = createScope({ label: 'tui-agent-status-bridge' });
      this.attachScope = scope;
      const remoteAgentStates = remote(
        tuiAgentsContract.agentStates,
        dependencies.client.agentStates,
        {
          scope,
          lingerMs: 15_000,
        }
      );
      const remoteSessions = remote(tuiAgentsContract.sessions, dependencies.client.sessions, {
        scope,
        lingerMs: 15_000,
      });
      const agentStatesList = remoteAgentStates(undefined).states.list;
      const sessionsList = remoteSessions(undefined).states.list;
      let firstAgentStates = true;
      let firstSessions = true;
      let agentStatesChain = Promise.resolve();
      let sessionsChain = Promise.resolve();
      observe(
        agentStatesList,
        (snapshot) => {
          if (snapshot.status === 'loading') return;
          const states = tuiAgentStateListSchema.parse(snapshot.value ?? {});
          const bootstrap = firstAgentStates;
          firstAgentStates = false;
          agentStatesChain = agentStatesChain
            .then(() => this.applyAgentStates(states, { bootstrap }))
            .catch((error) => {
              log.warn('TUI agent status bridge failed to apply agent states', {
                error: String(error),
              });
            });
        },
        { scope }
      );
      observe(
        sessionsList,
        (snapshot) => {
          if (snapshot.status === 'loading') return;
          const sessions = tuiSessionListSchema.parse(snapshot.value ?? {});
          const bootstrap = firstSessions;
          firstSessions = false;
          sessionsChain = sessionsChain
            .then(() => this.applySessions(sessions, { bootstrap }))
            .catch((error) => {
              log.warn('TUI agent status bridge failed to apply sessions', {
                error: String(error),
              });
            });
        },
        { scope }
      );

      await Promise.all([
        whenReady(agentStatesList, { scope }),
        whenReady(sessionsList, { scope }),
      ]);
      await Promise.all([agentStatesChain, sessionsChain]);
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
    this.agentStates.clear();
    this.sessions.clear();
    if (scope) void scope.dispose();
  }

  private async applyAgentStates(
    nextStates: TuiAgentStateList,
    options: { bootstrap?: boolean } = {}
  ): Promise<void> {
    const bootstrap = options.bootstrap ?? false;
    const seen = new Set<string>();

    for (const state of Object.values(nextStates)) {
      seen.add(state.conversationId);
      const previous = this.agentStates.get(state.conversationId);
      if (bootstrap) {
        await this.applyAgentStateSnapshot(state);
      } else if (shouldApplyAgentStateTransition(previous, state)) {
        await this.applyAgentStateTransition(state);
      }
      this.agentStates.set(state.conversationId, state);
    }

    for (const [conversationId, previous] of [...this.agentStates]) {
      if (seen.has(conversationId)) continue;
      await this.resetConversation(previous.conversationId);
      this.agentStates.delete(conversationId);
    }
  }

  private async applySessions(
    nextSessions: TuiSessionList,
    options: { bootstrap?: boolean } = {}
  ): Promise<void> {
    const bootstrap = options.bootstrap ?? false;
    const seen = new Set<string>();

    // Session ids are not persisted here: the TUI runtime reports resume handles into
    // the conversation index (spec §3.3) and convergence caches them client-side.
    for (const session of Object.values(nextSessions)) {
      seen.add(session.conversationId);
      const previous = this.sessions.get(session.conversationId);
      if (!bootstrap && previous?.status !== 'exited' && session.status === 'exited') {
        await this.resetConversation(session.conversationId);
      }
      this.sessions.set(session.conversationId, session);
    }

    for (const [conversationId, previous] of [...this.sessions]) {
      if (seen.has(conversationId)) continue;
      if (!bootstrap) await this.resetConversation(previous.conversationId);
      this.sessions.delete(conversationId);
    }
  }

  private async applyAgentStateSnapshot(state: TuiAgentState): Promise<void> {
    if (state.status === 'idle') {
      await this.resetConversation(state.conversationId);
      return;
    }
    const event = eventFromTuiAgentState(state);
    if (!event) return;
    await agentStatusService.cacheSignal(event);
  }

  private async applyAgentStateTransition(state: TuiAgentState): Promise<void> {
    if (state.status === 'idle') {
      await this.resetConversation(state.conversationId);
      return;
    }
    const event = eventFromTuiAgentState(state);
    if (!event) return;
    await agentStatusService.applySignal(event);
  }

  private async resetConversation(conversationId: string): Promise<void> {
    await agentStatusService.resetToIdle({ conversationId });
  }
}

export const tuiAgentStatusBridge = new TuiAgentStatusBridge();
