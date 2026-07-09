import {
  acpApiContract,
  initialSessionConfigState,
  type AgentState,
  type AuthStatusModelState,
  type PlanState,
  type PromptDraft,
  type SessionConfigState,
  type SessionState,
  type SessionSummary,
  type SessionUsage,
  type TerminalState,
  type TranscriptTurn,
} from '@emdash/core/acp';
import {
  createLiveModelHost,
  type LiveInstance,
  type LiveModelHost,
  type LiveState,
} from '@emdash/wire';

export type AcpSessionLiveHost = LiveModelHost<typeof acpApiContract.session>;
export type AcpSessionsLiveHost = LiveModelHost<typeof acpApiContract.sessions>;
export type AcpAuthStatusLiveHost = LiveModelHost<typeof acpApiContract.authStatus>;
export type SessionLiveModels = LiveInstance<typeof acpApiContract.session>;
export type SessionsListModel = LiveInstance<typeof acpApiContract.sessions>;
export type AuthStatusModel = LiveInstance<typeof acpApiContract.authStatus>;

export function createAcpSessionLiveHost(): AcpSessionLiveHost {
  return createLiveModelHost(acpApiContract.session);
}

export function createAcpSessionsLiveHost(): AcpSessionsLiveHost {
  return createLiveModelHost(acpApiContract.sessions);
}

export function createAcpAuthStatusLiveHost(): AcpAuthStatusLiveHost {
  return createLiveModelHost(acpApiContract.authStatus);
}

export function createAuthStatusModel(
  host: AcpAuthStatusLiveHost,
  providerId: string,
  initialState: AuthStatusModelState = {
    status: { kind: 'unknown' },
    login: null,
  }
): AuthStatusModel {
  return host.create({ providerId }, { status: initialState });
}

export function createSessionLiveModels(
  host: AcpSessionLiveHost,
  conversationId: string,
  initialState: SessionState
): SessionLiveModels {
  return host.create(
    { conversationId },
    {
      state: initialState,
      config: initialSessionConfigState,
      usage: null,
      plan: null,
      agents: [],
      activeTurn: null,
      draft: null,
      terminals: [],
    }
  );
}

export function createSessionsListModel(host: AcpSessionsLiveHost): SessionsListModel {
  return host.create(undefined, { list: {} });
}

export function publishLiveModelState<T>(
  model: LiveState<T>,
  next: T,
  previous: T | undefined
): void {
  if (Object.is(previous, next)) return;
  model.produce((draft) => {
    return assignDraft(draft, next) as never;
  });
}

export type {
  AgentState,
  PlanState,
  PromptDraft,
  SessionConfigState,
  SessionState,
  SessionSummary,
  SessionUsage,
  TerminalState,
  TranscriptTurn,
};

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
