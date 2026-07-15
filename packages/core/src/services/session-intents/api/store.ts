import { ok, type Result, type Serializable } from '@emdash/shared';
import type {
  SessionIntent,
  SessionIntentError,
  SessionIntentScope,
  SessionIntentStatus,
} from './schemas';

export type SaveActiveSessionIntentInput = {
  conversationId: string;
  payload: Serializable;
  sessionId?: string | null;
};

export type SessionIntentStore = {
  list(): Promise<Result<SessionIntent[], SessionIntentError>>;
  saveActive(input: SaveActiveSessionIntentInput): Promise<Result<void, SessionIntentError>>;
  markSuspended(conversationId: string, cause: string): Promise<Result<void, SessionIntentError>>;
  remove(conversationId: string): Promise<Result<void, SessionIntentError>>;
};

export function createNoopSessionIntentStore(): SessionIntentStore {
  return {
    async list() {
      return ok([]);
    },
    async saveActive() {
      return ok();
    },
    async markSuspended() {
      return ok();
    },
    async remove() {
      return ok();
    },
  };
}

export function sessionIntentFromActiveInput(
  input: SaveActiveSessionIntentInput,
  now: number
): SessionIntent {
  return {
    conversationId: input.conversationId,
    status: 'active',
    payload: input.payload,
    sessionId: input.sessionId,
    updatedAt: now,
  };
}

export type SessionIntentSetStatusInput = {
  scope: SessionIntentScope;
  conversationId: string;
  status: SessionIntentStatus;
  cause?: string;
};
