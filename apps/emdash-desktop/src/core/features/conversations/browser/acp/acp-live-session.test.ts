import { createScope } from '@emdash/shared/concurrency';
import { cell, flushStateTurn } from '@emdash/wire/state';
import { reaction } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import { AcpLiveSession, remoteValueState } from './acp-live-session';

describe('remoteValueState', () => {
  it('invalidates MobX reactions when the Wire state changes', async () => {
    const source = cell<number | undefined>(1);
    const scope = createScope({ label: 'remote-value-state-test' });
    const state = remoteValueState(source, scope);
    await state.ready;

    const seen: number[] = [];
    const dispose = reaction(
      () => state.current(),
      (value) => seen.push(value),
      {
        fireImmediately: true,
      }
    );

    source.set(2);
    flushStateTurn();

    expect(seen).toEqual([1, 2]);

    dispose();
    await scope.dispose();
  });

  it('preserves the identity of contract-decoded snapshots', async () => {
    const initial = { nested: { value: 1 } };
    const source = cell<typeof initial | undefined>(initial);
    const scope = createScope({ label: 'remote-value-state-identity-test' });
    const state = remoteValueState(source, scope);
    await state.ready;

    expect(state.current()).toBe(initial);
    expect(state.current().nested).toBe(initial.nested);
    await scope.dispose();
  });
});

describe('AcpLiveSession.sendPrompt', () => {
  it('uses its captured activation fence and disables the Wire deadline', async () => {
    const sendPrompt = vi.fn(async () => ({ success: true, data: { queued: false } }));
    const session = Object.assign(Object.create(AcpLiveSession.prototype), {
      conversationId: 'conversation-1',
      client: { sendPrompt },
      activationFence: 'activation-1',
      activationId: { current: () => 'replacement-activation' },
    }) as AcpLiveSession;

    await session.sendPrompt({ text: 'hello' });

    expect(sendPrompt).toHaveBeenCalledWith(
      {
        conversationId: 'conversation-1',
        prompt: { text: 'hello' },
        placement: undefined,
        activationId: 'activation-1',
      },
      { timeoutMs: 0 }
    );
  });

  it('rejects terminal reads after its activation has been replaced', async () => {
    const session = Object.assign(Object.create(AcpLiveSession.prototype), {
      conversationId: 'conversation-1',
      activationFence: 'activation-1',
      activationId: { current: () => 'replacement-activation' },
      disposed: false,
      terminalLogs: new Map(),
    }) as AcpLiveSession;

    await expect(session.terminalOutput('terminal-1')).rejects.toThrow(/activation changed/i);
  });
});
