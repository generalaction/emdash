import { formatHostRef, hostRef, LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { StageContext } from '@emdash/core/primitives/kernel/api';
import type { RuntimeBroker, RuntimeSession } from '@emdash/core/services/runtime-broker/api';
import { err, ok } from '@emdash/shared';
import { DisposableTimerHandle, type Clock } from '@emdash/shared/scheduling';
import { describe, expect, it, vi } from 'vitest';
import type { HostDeleteConversationInput } from '@core/features/conversations/api/node/host-delete-conversation-operation';
import type { AppDb } from '@core/services/app-db/node/db';
import { createHostDeleteConversationDefinition } from './host-delete-conversation-definition';

const testClock: Clock = {
  now: () => 0,
  // Timeouts never fire in these tests.
  schedule: () => new DisposableTimerHandle(() => {}),
  sleep: async () => {},
};

const runtime = { db: {} as AppDb, clock: testClock };

function deleteInput(
  overrides: Partial<HostDeleteConversationInput> = {}
): HostDeleteConversationInput {
  return {
    version: '1',
    source: 'user',
    hostOperationId: 'host-op-1',
    hostRef: formatHostRef(LOCAL_HOST_REF),
    conversationId: 'conversation-1',
    entityName: 'Example conversation',
    createdAt: 0,
    ...overrides,
  };
}

function fakeCtx(input: HostDeleteConversationInput) {
  const stages: Array<{ id: string; status: 'succeeded' | 'failed' }> = [];
  const rejections: unknown[] = [];
  const controller = new AbortController();
  const ctx = {
    input,
    operationId: 'kernel-op-1',
    attempt: 0,
    signal: controller.signal,
    stage: async <T>(id: string, _label: string, work: (stage: StageContext) => Promise<T>) => {
      try {
        const value = await work({
          progress: () => {},
          fail: () => {},
          signal: controller.signal,
        });
        stages.push({ id, status: 'succeeded' });
        return value;
      } catch (error) {
        stages.push({ id, status: 'failed' });
        throw error;
      }
    },
    run: async () => {
      throw new Error('not used');
    },
    spawn: async () => {
      throw new Error('not used');
    },
    reject: (error: unknown): never => {
      rejections.push(error);
      throw Object.assign(new Error('rejected'), { rejected: error });
    },
    fact: () => {},
  };
  return { ctx, stages, rejections };
}

function fakeHostClient(overrides: {
  killAcp?: ReturnType<typeof vi.fn>;
  deleteTui?: ReturnType<typeof vi.fn>;
  deleteRecord?: ReturnType<typeof vi.fn>;
}) {
  const calls: string[] = [];
  const killAcp =
    overrides.killAcp ??
    vi.fn(async () => {
      calls.push('acp.killSession');
      return ok(undefined);
    });
  const deleteTui =
    overrides.deleteTui ??
    vi.fn(async () => {
      calls.push('tuiAgents.deleteSession');
      return ok(undefined);
    });
  const deleteRecord =
    overrides.deleteRecord ??
    vi.fn(async () => {
      calls.push('conversations.delete');
      return ok(undefined);
    });
  const runtimes = {
    client: async (_host: Parameters<RuntimeBroker['client']>[0]) =>
      ok({
        acp: { killSession: killAcp },
        tuiAgents: { deleteSession: deleteTui },
        conversations: { delete: deleteRecord },
      }) as unknown as RuntimeSession,
  } satisfies Pick<RuntimeBroker, 'client'>;
  return { runtimes, calls, killAcp, deleteTui, deleteRecord };
}

describe('host delete conversation definition', () => {
  it('kills both session surfaces before deleting the index record', async () => {
    const host = fakeHostClient({});
    const definition = createHostDeleteConversationDefinition({ runtimes: host.runtimes }, runtime);
    const { ctx, stages } = fakeCtx(deleteInput());

    await expect(definition.handler.run(ctx as never)).resolves.toEqual({ ok: true });

    // Session kill is part of the verb (spec §4.3) — strictly ordered before the delete.
    expect(host.calls).toEqual([
      'acp.killSession',
      'tuiAgents.deleteSession',
      'conversations.delete',
    ]);
    expect(host.killAcp).toHaveBeenCalledWith({ conversationId: 'conversation-1' });
    expect(host.deleteTui).toHaveBeenCalledWith({ conversationId: 'conversation-1' });
    expect(host.deleteRecord).toHaveBeenCalledWith({ id: 'conversation-1' });
    expect(stages).toEqual([
      { id: 'kill-sessions', status: 'succeeded' },
      { id: 'delete-record', status: 'succeeded' },
    ]);
  });

  it('deletes the record even when session kills fail', async () => {
    const host = fakeHostClient({
      killAcp: vi.fn(async () => {
        throw new Error('acp runtime crashed');
      }),
      deleteTui: vi.fn(async () => {
        throw new Error('tui runtime crashed');
      }),
    });
    const definition = createHostDeleteConversationDefinition({ runtimes: host.runtimes }, runtime);
    const { ctx } = fakeCtx(deleteInput());

    await expect(definition.handler.run(ctx as never)).resolves.toEqual({ ok: true });
    expect(host.deleteRecord).toHaveBeenCalledWith({ id: 'conversation-1' });
  });

  it('rejects retryable when the host is unreachable', async () => {
    const runtimes = {
      client: async () =>
        err({ type: 'ssh-connection-failed', message: 'down' }) as unknown as RuntimeSession,
    } satisfies Pick<RuntimeBroker, 'client'>;
    const definition = createHostDeleteConversationDefinition({ runtimes }, runtime);
    const { ctx, rejections } = fakeCtx(
      deleteInput({ hostRef: formatHostRef(hostRef('remote', 'conn-1')) })
    );

    await expect(definition.handler.run(ctx as never)).rejects.toMatchObject({
      code: 'host-unreachable',
      retryable: true,
    });
    expect(rejections).toHaveLength(0);
  });

  it('requires confirmation for unconfirmed reconciler proposals', async () => {
    const host = fakeHostClient({});
    const definition = createHostDeleteConversationDefinition({ runtimes: host.runtimes }, runtime);
    const { ctx, rejections } = fakeCtx(deleteInput({ source: 'reconciler' }));

    await expect(definition.handler.run(ctx as never)).rejects.toThrow('rejected');
    expect(rejections).toEqual([
      { type: 'needs-confirmation', reason: 'reconciler-proposed', message: undefined },
    ]);
    expect(host.deleteRecord).not.toHaveBeenCalled();
  });
});
