import { err, ok, type Result, type Serializable } from '@emdash/shared';
import { createController } from '@emdash/wire';
import { defineWireComponent } from '@emdash/wire/component';
import type { KeyValueStore } from '@primitives/kv/api';
import {
  sessionIntentSchema,
  sessionIntentsContract,
  type SessionIntent,
  type SessionIntentError,
  type SessionIntentScope,
  type SessionIntentStatus,
} from '@services/session-intents/api';
import { z } from 'zod';

const STORE_KEY_PREFIX = 'session-intents';

export const sessionIntentsComponentConfigSchema = z.object({});

export type CreateSessionIntentsComponentOptions = {
  store: KeyValueStore;
};

export function createSessionIntentsComponent(options: CreateSessionIntentsComponentOptions) {
  return defineWireComponent({
    id: 'session-intents',
    contract: sessionIntentsContract,
    requirements: {},
    configSchema: sessionIntentsComponentConfigSchema,
    create: ({ instance, scope }) => {
      const runtime = new SessionIntentsRuntime(options.store);
      return instance({
        scope,
        controller: createSessionIntentsController(runtime),
      });
    },
  });
}

export function createSessionIntentsController(runtime: SessionIntentsRuntime) {
  return createController(sessionIntentsContract, {
    list: ({ scope }) => runtime.list(scope),
    upsert: ({ scope, intent }) => runtime.upsert(scope, intent),
    setStatus: ({ scope, conversationId, status, cause }) =>
      runtime.setStatus(scope, conversationId, status, cause),
    delete: ({ scope, conversationId }) => runtime.delete(scope, conversationId),
  });
}

export class SessionIntentsRuntime {
  constructor(private readonly store: KeyValueStore) {}

  async list(scope: SessionIntentScope): Promise<Result<SessionIntent[], SessionIntentError>> {
    const loaded = await this.store.getAll();
    if (!loaded.success) return err(toSessionIntentError(loaded.error));

    const prefix = `${this.scopeKey(scope)}:`;
    const result: SessionIntent[] = [];
    for (const [key, value] of Object.entries(loaded.data)) {
      if (!key.startsWith(prefix)) continue;
      const parsed = sessionIntentSchema.safeParse(value);
      if (!parsed.success) continue;
      result.push(parsed.data);
    }
    result.sort((a, b) => a.updatedAt - b.updatedAt);
    return ok(result);
  }

  async upsert(
    scope: SessionIntentScope,
    intent: SessionIntent
  ): Promise<Result<void, SessionIntentError>> {
    const saved = await this.store.set(
      this.intentKey(scope, intent.conversationId),
      intent as unknown as Serializable
    );
    if (!saved.success) return err(toSessionIntentError(saved.error));
    return ok();
  }

  async setStatus(
    scope: SessionIntentScope,
    conversationId: string,
    status: SessionIntentStatus,
    cause?: string
  ): Promise<Result<void, SessionIntentError>> {
    const loaded = await this.store.get(this.intentKey(scope, conversationId));
    if (!loaded.success) return err(toSessionIntentError(loaded.error));
    if (loaded.data === null) return ok();

    const parsed = sessionIntentSchema.safeParse(loaded.data);
    if (!parsed.success) {
      return err({
        type: 'decode',
        key: this.intentKey(scope, conversationId),
        message: z.prettifyError(parsed.error),
      });
    }

    const next: SessionIntent = {
      ...parsed.data,
      status,
      suspendedCause: status === 'suspended' ? cause : undefined,
      updatedAt: Date.now(),
    };
    return this.upsert(scope, next);
  }

  async delete(
    scope: SessionIntentScope,
    conversationId: string
  ): Promise<Result<void, SessionIntentError>> {
    const deleted = await this.store.delete(this.intentKey(scope, conversationId));
    if (!deleted.success) return err(toSessionIntentError(deleted.error));
    return ok();
  }

  private intentKey(scope: SessionIntentScope, conversationId: string): string {
    return `${this.scopeKey(scope)}:${conversationId}`;
  }

  private scopeKey(scope: SessionIntentScope): string {
    return `${STORE_KEY_PREFIX}:${scope}`;
  }
}

function toSessionIntentError(error: { message: string; key?: string }): SessionIntentError {
  return { type: 'io', message: error.message, key: error.key };
}
