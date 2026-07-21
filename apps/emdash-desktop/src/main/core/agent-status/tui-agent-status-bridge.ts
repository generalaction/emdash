import {
  tuiAgentStateListSchema,
  tuiSessionListSchema,
  type TuiAgentState,
  type TuiAgentStateList,
  type TuiSessionList,
  type TuiSessionState,
} from '@emdash/core/runtimes/tui-agents/api';
import type { Unsubscribe } from '@emdash/shared';
import { ReplicaState } from '@emdash/wire';
import type { ConversationEvent } from '@core/primitives/conversations/api';
import { getTuiAgentsRuntimeClient, tuiAgentsWorker } from '@main/gateway/desktop-workers';
import { log } from '@main/lib/logger';
import { agentStatusService } from './agent-status-service';
import {
  eventFromTuiAgentState,
  shouldApplyAgentStateTransition,
} from './tui-agent-status-transition';

type TuiAgentStatusBridgeDependencies = {
  setSessionId(
    conversationId: string,
    sessionId: string
  ): Promise<
    | { success: true; data: { taskId: string; projectId: string } }
    | { success: false; error: { type: string } }
  >;
  publishConversationEvent(event: ConversationEvent): void;
};

class TuiAgentStatusBridge {
  private readonly agentStates = new Map<string, TuiAgentState>();
  private readonly sessions = new Map<string, TuiSessionState>();
  private workerStateUnsubscribe: Unsubscribe | null = null;
  private agentStatesReplica: ReplicaState<TuiAgentStateList> | null = null;
  private sessionsReplica: ReplicaState<TuiSessionList> | null = null;
  private attaching = false;
  private agentStatesBootstrapped = false;
  private sessionsBootstrapped = false;
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
      const tuiClient = await getTuiAgentsRuntimeClient();
      this.workerStateUnsubscribe =
        tuiAgentsWorker?.onStateChanged((state) => {
          if (state.kind !== 'failed' && state.kind !== 'disposed') return;
          this.detach();
        }) ?? null;

      const agentStatesReplica = new ReplicaState<TuiAgentStateList>(
        tuiClient.agentStates.state(undefined, 'list'),
        {
          schema: tuiAgentStateListSchema,
          onChange: (states) => void this.applyAgentStates(states),
        }
      );
      const sessionsReplica = new ReplicaState<TuiSessionList>(
        tuiClient.sessions.state(undefined, 'list'),
        {
          schema: tuiSessionListSchema,
          onChange: (sessions) => void this.applySessions(sessions),
        }
      );

      await Promise.all([agentStatesReplica.ready, sessionsReplica.ready]);
      this.agentStatesReplica = agentStatesReplica;
      this.sessionsReplica = sessionsReplica;
      await this.applyAgentStates(agentStatesReplica.current(), { bootstrap: true });
      await this.applySessions(sessionsReplica.current(), { bootstrap: true });
      this.agentStatesBootstrapped = true;
      this.sessionsBootstrapped = true;
    } finally {
      this.attaching = false;
    }
  }

  private detach(): void {
    this.workerStateUnsubscribe?.();
    this.workerStateUnsubscribe = null;
    const agentStatesReplica = this.agentStatesReplica;
    const sessionsReplica = this.sessionsReplica;
    this.agentStatesReplica = null;
    this.sessionsReplica = null;
    this.agentStatesBootstrapped = false;
    this.sessionsBootstrapped = false;
    this.agentStates.clear();
    this.sessions.clear();
    if (agentStatesReplica) void agentStatesReplica.dispose();
    if (sessionsReplica) void sessionsReplica.dispose();
  }

  private async applyAgentStates(
    nextStates: TuiAgentStateList,
    options: { bootstrap?: boolean } = {}
  ): Promise<void> {
    const bootstrap = options.bootstrap ?? !this.agentStatesBootstrapped;
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
    const bootstrap = options.bootstrap ?? !this.sessionsBootstrapped;
    const seen = new Set<string>();

    for (const session of Object.values(nextSessions)) {
      seen.add(session.conversationId);
      const previous = this.sessions.get(session.conversationId);
      await this.persistSessionIdIfChanged(previous, session);
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

  private async persistSessionIdIfChanged(
    previous: TuiSessionState | undefined,
    session: TuiSessionState
  ): Promise<void> {
    if (!session.sessionId || previous?.sessionId === session.sessionId) return;
    const dependencies = this.dependencies;
    if (!dependencies) throw new Error('TUI agent status bridge has not been initialized');
    const result = await dependencies.setSessionId(session.conversationId, session.sessionId);
    if (!result.success) {
      log.warn('TUI agent status bridge failed to persist session id', {
        conversationId: session.conversationId,
        error: result.error.type,
      });
      return;
    }

    dependencies.publishConversationEvent({
      type: 'changed',
      conversationId: session.conversationId,
      taskId: result.data.taskId,
      projectId: result.data.projectId,
      changes: { sessionId: session.sessionId },
    });
  }
}

export const tuiAgentStatusBridge = new TuiAgentStatusBridge();
