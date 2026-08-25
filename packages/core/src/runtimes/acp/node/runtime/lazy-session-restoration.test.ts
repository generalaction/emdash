import type { Serializable } from '@emdash/shared';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import {
  createMemorySessionIntentStore,
  type SessionIntentStore,
} from '#services/session-intents/api';
import { AcpRuntime } from './runtime';
import type { AcpStartInput } from './types';

describe('lazy ACP session restoration', () => {
  it('indexes suspended intents and projects their list rows without creating handles', async () => {
    const intents = createMemorySessionIntentStore();
    await seedSuspendedIntent(intents, makeStartInput({ conversationId: 'conv-one' }));
    await seedSuspendedIntent(
      intents,
      makeStartInput({ conversationId: 'conv-two', cwd: '/tmp/other' })
    );
    const harness = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(harness.deps);

    await runtime.reconcile();

    expect(runtime.manager.inspect().retained).toEqual([]);
    expect(runtime.manager.inspect().indexedSuspended).toEqual(['conv-one', 'conv-two']);
    expect(peek(runtime.sessionsListLiveModel().states.list)).toMatchObject({
      'conv-one': {
        conversationId: 'conv-one',
        providerId: 'claude',
        cwd: '/tmp/workspace',
        suspended: true,
      },
      'conv-two': {
        conversationId: 'conv-two',
        providerId: 'claude',
        cwd: '/tmp/other',
        suspended: true,
      },
    });
    expect(harness.agent.loadSession).not.toHaveBeenCalled();

    await runtime.dispose();
  });

  it('hydrates one indexed conversation on first touch without waking the provider', async () => {
    const intents = createMemorySessionIntentStore();
    await seedSuspendedIntent(intents, makeStartInput({ conversationId: 'conv-one' }));
    await seedSuspendedIntent(intents, makeStartInput({ conversationId: 'conv-two' }));
    const harness = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(harness.deps);
    await runtime.reconcile();

    expect(runtime.getSessionState('conv-one')).toMatchObject({ suspended: true });
    expect(runtime.manager.inspect().retained).toEqual([]);

    expect(runtime.sessionLiveModels('conv-one')).not.toBeNull();

    expect(runtime.manager.inspect().retained).toContain('conv-one');
    expect(runtime.manager.inspect().retained).not.toContain('conv-two');
    expect(runtime.manager.inspect().indexedSuspended).not.toContain('conv-one');
    expect(runtime.manager.inspect().indexedSuspended).toContain('conv-two');
    expect(harness.agent.loadSession).not.toHaveBeenCalled();

    await runtime.reconcile();

    expect(Object.keys(peek(runtime.sessionsListLiveModel().states.list)).sort()).toEqual([
      'conv-one',
      'conv-two',
    ]);
    expect(runtime.manager.inspect().retained).toContain('conv-one');
    expect(harness.agent.loadSession).not.toHaveBeenCalled();

    await runtime.dispose();
  });

  it('kills an index-only conversation without materializing it', async () => {
    const intents = createMemorySessionIntentStore();
    await seedSuspendedIntent(intents, makeStartInput({ conversationId: 'conv-cleanup' }));
    const harness = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(harness.deps);
    await runtime.reconcile();
    const remove = vi.spyOn(intents, 'remove');

    await runtime.killSession('conv-cleanup');

    expect(remove).toHaveBeenCalledWith('conv-cleanup');
    expect(intents.snapshot()).toEqual([]);
    expect(runtime.manager.inspect().retained).toEqual([]);
    expect(runtime.manager.inspect().indexedSuspended).toEqual([]);
    expect(peek(runtime.sessionsListLiveModel().states.list)).not.toHaveProperty('conv-cleanup');
    expect(harness.agent.loadSession).not.toHaveBeenCalled();
    expect(harness.agent.closeSession).not.toHaveBeenCalled();

    await runtime.dispose();
  });
});

async function seedSuspendedIntent(
  intents: SessionIntentStore,
  input: AcpStartInput
): Promise<void> {
  const { initialQueue: _initialQueue, ...payload } = input;
  const sessionId = `${input.conversationId}-session`;
  const saved = await intents.saveActive({
    conversationId: input.conversationId,
    sessionId,
    payload: { ...payload, sessionId } as unknown as Serializable,
  });
  if (!saved.success) throw new Error(saved.error.message);
  const suspended = await intents.markSuspended(input.conversationId, 'test');
  if (!suspended.success) throw new Error(suspended.error.message);
}
