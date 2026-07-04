import { LiveModelServer } from '../../live/model';
import type { AgentState } from '../models/agents';
import { initialSessionConfigState, type SessionConfigState } from '../models/config';
import type { PlanState } from '../models/plan';
import type { SessionState, SessionSummary } from '../models/session';
import type { TranscriptTurn } from '../models/turns';

export interface SessionLiveModels {
  sessionState: LiveModelServer<SessionState>;
  config: LiveModelServer<SessionConfigState>;
  plan: LiveModelServer<PlanState | null>;
  agents: LiveModelServer<AgentState[]>;
  activeTurn: LiveModelServer<TranscriptTurn | null>;
}

export type SessionsListModel = LiveModelServer<Record<string, SessionSummary>>;

export function createSessionLiveModels(initialState: SessionState): SessionLiveModels {
  return {
    sessionState: new LiveModelServer(initialState),
    config: new LiveModelServer(initialSessionConfigState),
    plan: new LiveModelServer<PlanState | null>(null),
    agents: new LiveModelServer<AgentState[]>([]),
    activeTurn: new LiveModelServer<TranscriptTurn | null>(null),
  };
}

export function createSessionsListModel(): SessionsListModel {
  return new LiveModelServer<Record<string, SessionSummary>>({});
}

export function replaceLiveModelState<T>(model: LiveModelServer<T>, next: T): void {
  model.produce(() => {
    return structuredClone(next) as never;
  });
}