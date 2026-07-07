import { LiveModelServer } from '../../live/model';
import type { AgentState } from '../models/agents';
import {
  initialSessionConfigState,
  type SessionConfigState,
  type SessionUsage,
} from '../models/config';
import type { PlanState } from '../models/plan';
import type { PromptDraft } from '../models/prompt';
import type { SessionState, SessionSummary } from '../models/session';
import type { TranscriptTurn } from '../models/turns';

export interface SessionLiveModels {
  sessionState: LiveModelServer<SessionState>;
  config: LiveModelServer<SessionConfigState>;
  usage: LiveModelServer<SessionUsage | null>;
  plan: LiveModelServer<PlanState | null>;
  agents: LiveModelServer<AgentState[]>;
  activeTurn: LiveModelServer<TranscriptTurn | null>;
  draft: LiveModelServer<PromptDraft | null>;
}

export type SessionsListModel = LiveModelServer<Record<string, SessionSummary>>;

export function createSessionLiveModels(initialState: SessionState): SessionLiveModels {
  return {
    sessionState: new LiveModelServer(initialState),
    config: new LiveModelServer(initialSessionConfigState),
    usage: new LiveModelServer<SessionUsage | null>(null),
    plan: new LiveModelServer<PlanState | null>(null),
    agents: new LiveModelServer<AgentState[]>([]),
    activeTurn: new LiveModelServer<TranscriptTurn | null>(null),
    draft: new LiveModelServer<PromptDraft | null>(null),
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
    return assignDraft(draft, next) as never;
  });
}

function assignDraft<T>(draft: T, next: T): T | void {
  if (!isObjectLike(draft) || !isObjectLike(next)) {
    return structuredClone(next);
  }

  if (Array.isArray(draft) || Array.isArray(next)) {
    if (!Array.isArray(draft) || !Array.isArray(next)) {
      return structuredClone(next);
    }
    draft.length = next.length;
    for (let index = 0; index < next.length; index += 1) {
      const current = draft[index];
      const incoming = next[index];
      if (Object.is(current, incoming)) continue;
      if (isObjectLike(current) && isObjectLike(incoming)) {
        const replacement = assignDraft(current, incoming);
        if (replacement !== undefined) draft[index] = replacement;
      } else {
        draft[index] = incoming;
      }
    }
    return;
  }

  const draftRecord = draft as Record<string, unknown>;
  const nextRecord = next as Record<string, unknown>;
  for (const key of Object.keys(draftRecord)) {
    if (!(key in nextRecord)) {
      delete draftRecord[key];
    }
  }
  for (const [key, incoming] of Object.entries(nextRecord)) {
    const current = draftRecord[key];
    if (Object.is(current, incoming)) continue;
    if (isObjectLike(current) && isObjectLike(incoming)) {
      const replacement = assignDraft(current, incoming);
      if (replacement !== undefined) draftRecord[key] = replacement;
    } else {
      draftRecord[key] = incoming;
    }
  }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
