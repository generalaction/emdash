import { ok, type Result } from '@emdash/shared';
import type { ContractClient } from '@emdash/wire/api';
import type {
  SaveActiveSessionIntentInput,
  SessionIntent,
  SessionIntentError,
  SessionIntentScope,
  SessionIntentStore,
} from '@services/session-intents/api';
import { sessionIntentFromActiveInput, type SessionIntentsContract } from '@services/session-intents/api';

export function createSessionIntentStoreFromDependency(
  client: ContractClient<SessionIntentsContract>,
  scope: SessionIntentScope,
  options: { now?: () => number } = {}
): SessionIntentStore {
  const now = options.now ?? Date.now;
  return {
    list() {
      return client.list({ scope });
    },
    saveActive(input) {
      return client.upsert({
        scope,
        intent: sessionIntentFromActiveInput(input, now()),
      });
    },
    markSuspended(conversationId, cause) {
      return client.setStatus({
        scope,
        conversationId,
        status: 'suspended',
        cause,
      });
    },
    remove(conversationId) {
      return client.delete({ scope, conversationId });
    },
  };
}

export function createMemorySessionIntentStore(
  options: { now?: () => number } = {}
): SessionIntentStore & { snapshot(): SessionIntent[] } {
  const now = options.now ?? Date.now;
  const intents = new Map<string, SessionIntent>();
  const success = (): Result<void, SessionIntentError> => ok();
  return {
    async list() {
      return ok(Array.from(intents.values()));
    },
    async saveActive(input: SaveActiveSessionIntentInput) {
      intents.set(input.conversationId, sessionIntentFromActiveInput(input, now()));
      return success();
    },
    async markSuspended(conversationId, cause) {
      const existing = intents.get(conversationId);
      if (!existing) return success();
      intents.set(conversationId, {
        ...existing,
        status: 'suspended',
        suspendedCause: cause,
        updatedAt: now(),
      });
      return success();
    },
    async remove(conversationId) {
      intents.delete(conversationId);
      return success();
    },
    snapshot() {
      return Array.from(intents.values());
    },
  };
}
