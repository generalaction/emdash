import { createScope } from '@emdash/shared/concurrency';
import { cell, flushStateTurn } from '@emdash/wire/state';
import { reaction } from 'mobx';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AcpLiveSession,
  AcpPromptDeliveryUnknownError,
  remoteValueState,
} from './acp-live-session';

describe('remoteValueState', () => {
  it('invalidates MobX reactions when the Wire state changes', async () => {
    const source = cell<number | undefined>(1);
    const scope = createScope({ label: 'remote-value-state-test' });
    const state = remoteValueState(source, z.number(), scope);
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
});

describe('AcpLiveSession.sendPrompt', () => {
  it('requests session acceptance with a prompt correlation id and allows activation to finish', async () => {
    const sendPrompt = vi.fn(async () => ({ success: true, data: { queued: false } }));
    const session = Object.assign(Object.create(AcpLiveSession.prototype), {
      conversationId: 'conversation-1',
      client: { sendPrompt },
    }) as AcpLiveSession;

    await session.sendPrompt({ text: 'hello' });

    expect(sendPrompt).toHaveBeenCalledWith(
      {
        conversationId: 'conversation-1',
        promptId: expect.any(String),
        prompt: { text: 'hello' },
        placement: undefined,
      },
      { timeoutMs: 0 }
    );
  });

  it('preserves the submitted id when delivery confirmation is lost', async () => {
    const sendPrompt = vi.fn().mockRejectedValue(new Error('disconnected'));
    const session = Object.assign(Object.create(AcpLiveSession.prototype), {
      conversationId: 'conversation-1',
      client: { sendPrompt },
    }) as AcpLiveSession;
    const failure = await session.sendPrompt({ text: 'hello' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AcpPromptDeliveryUnknownError);
    expect(failure).toMatchObject({ promptId: sendPrompt.mock.calls[0][0].promptId });
    expect(sendPrompt).toHaveBeenCalledOnce();
  });
});

describe('AcpLiveSession.loadHistory', () => {
  it('loads activation-aware history by conversation id', async () => {
    const loadHistory = vi.fn(async () => ({
      success: true as const,
      data: {
        turns: [],
        nextCursor: null,
        unavailable: true as const,
      },
    }));
    const session = Object.assign(Object.create(AcpLiveSession.prototype), {
      conversationId: 'conversation-1',
      client: { loadHistory },
    }) as AcpLiveSession;

    await expect(session.loadHistory(undefined, 100)).resolves.toEqual({
      success: true,
      data: { turns: [], nextCursor: null, unavailable: true },
    });
    expect(loadHistory).toHaveBeenCalledWith({
      conversationId: 'conversation-1',
      before: undefined,
      limit: 100,
    });
  });
});
