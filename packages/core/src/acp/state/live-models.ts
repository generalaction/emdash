import { LiveModelServer, reconcileDraft } from '../../live/model';
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

export function publishLiveModelState<T>(
  model: LiveModelServer<T>,
  next: T,
  previous: T | undefined
): void {
  if (Object.is(previous, next)) return;
  model.produce((draft) => {
    return reconcileDraft(draft, next) as never;
  });
}
