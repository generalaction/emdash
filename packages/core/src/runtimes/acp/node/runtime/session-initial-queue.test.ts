import { err, type Serializable } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { acpErr } from '#runtimes/acp/api';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { SessionCell } from '#runtimes/acp/node/session/cell';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import { AcpRuntime } from './runtime';

const input = makeStartInput({
  conversationId: 'initial-queue',
  initialQueue: [{ text: 'first' }, { text: 'second', hiddenContext: 'private context' }],
});

describe('ACP initial queue persistence', () => {
  for (const operation of ['stop', 'terminate'] as const) {
    it.each([false, true])(
      `never dispatches from a stopped preparation (${operation}, commit=%s)`,
      async (success) => {
        const intents = createMemorySessionIntentStore();
        const h = makeAcpHarness({ intents });
        const runtime = new AcpRuntime(h.deps);
        const entered = deferred<void>();
        const finish = deferred<void>();
        const originalSave = intents.saveActive.bind(intents);
        vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
          if ((intent.payload as { initialQueueConsumed: boolean }).initialQueueConsumed) {
            entered.resolve();
            await finish.promise;
            if (!success) return err({ type: 'io', message: 'disk full' });
          }
          return originalSave(intent);
        });
        const starting = runtime.startSession(input, 'resume');
        try {
          await entered.promise;
          const stopping =
            operation === 'stop'
              ? runtime.stopSession(input.conversationId)
              : runtime.terminateSession(input.conversationId);
          await new Promise<void>((resolve) => setImmediate(resolve));
          finish.resolve();
          await Promise.all([starting, stopping]);
          expect(h.agent.prompt).not.toHaveBeenCalled();
          if (operation === 'terminate') expect(intents.snapshot()).toEqual([]);
          else
            expect(intents.snapshot()[0]?.payload).toMatchObject({ initialQueueConsumed: success });
        } finally {
          finish.resolve();
          await starting;
          await runtime.dispose();
        }
      }
    );
  }

  for (const retry of ['same worker', 'restarted worker'] as const) {
    it.each(['result', 'throw'] as const)(
      `retains prepared prompts after a failed dispatch commit (%s, ${retry})`,
      async (failure) => {
        const intents = createMemorySessionIntentStore();
        const h = makeAcpHarness({ intents });
        let runtime = new AcpRuntime(h.deps);
        const originalSave = intents.saveActive.bind(intents);
        const save = vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
          if ((intent.payload as { initialQueueConsumed: boolean }).initialQueueConsumed) {
            if (failure === 'throw') throw new Error('disk full');
            return err({ type: 'io', message: 'disk full' });
          }
          return originalSave(intent);
        });
        try {
          expect((await runtime.startSession(input, 'resume')).success).toBe(false);
          expect(h.agent.prompt).not.toHaveBeenCalled();
          expect(intents.snapshot()[0]).toMatchObject({
            sessionId: 'session-1',
            payload: { unstarted: true, initialQueueConsumed: false },
          });
          // Unrelated writes must not publish the failed consumption candidate.
          await runtime.setOption(input.conversationId, 'model', 'updated');
          await vi.waitFor(() =>
            expect(intents.snapshot()[0]?.payload).toMatchObject({
              configured: { model: 'updated' },
              initialQueueConsumed: false,
            })
          );
          save.mockRestore();
          if (retry === 'restarted worker') {
            await runtime.dispose();
            runtime = new AcpRuntime(h.deps);
            await runtime.reconcile();
          }
          expect((await runtime.startSession(input, 'resume')).success).toBe(true);
          await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
          expect(h.agent.prompt.mock.calls.map(([request]) => request.prompt)).toEqual([
            [{ type: 'text', text: 'first' }],
            [
              { type: 'text', text: 'second' },
              { type: 'text', text: 'private context' },
            ],
          ]);
          expect(intents.snapshot()[0]?.payload).toMatchObject({
            unstarted: false,
            initialQueueConsumed: true,
          });
          expect(JSON.stringify(intents.snapshot())).not.toContain('private context');
        } finally {
          save.mockRestore();
          await runtime.dispose();
        }
      }
    );
  }

  it.each(['second queue entry', 'readiness after transition'] as const)(
    'does not dispatch a partially prepared queue when %s fails',
    async (failure) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      let runtime = new AcpRuntime(h.deps);
      const queue = SessionCell.prototype.queuePrompt;
      const ready = SessionCell.prototype.applySessionReady;
      const fault =
        failure === 'second queue entry'
          ? vi
              .spyOn(SessionCell.prototype, 'queuePrompt')
              .mockImplementationOnce(function (this: SessionCell, ...args) {
                return queue.apply(this, args);
              })
              .mockReturnValueOnce(acpErr.invalidState('second entry rejected'))
          : vi.spyOn(SessionCell.prototype, 'applySessionReady').mockImplementationOnce(function (
              this: SessionCell,
              ...args
            ) {
              ready.apply(this, args);
              throw new Error('failed after readiness');
            });
      try {
        expect((await runtime.startSession(input, 'resume')).success).toBe(false);
        expect(h.agent.prompt).not.toHaveBeenCalled();
        expect(intents.snapshot()[0]?.payload).toMatchObject({ initialQueueConsumed: false });
        await runtime.dispose();
        runtime = new AcpRuntime(h.deps);
        await runtime.reconcile();
        expect((await runtime.startSession(input, 'resume')).success).toBe(true);
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
      } finally {
        fault.mockRestore();
        await runtime.dispose();
      }
    }
  );

  it('recovers pending prompts from a crash snapshot before the dispatch commit', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const entered = deferred<void>();
    const finish = deferred<void>();
    const originalSave = intents.saveActive.bind(intents);
    vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
      if ((intent.payload as { initialQueueConsumed: boolean }).initialQueueConsumed) {
        entered.resolve();
        await finish.promise;
        return err({ type: 'io', message: 'worker lost before commit' });
      }
      return originalSave(intent);
    });
    const starting = runtime.startSession(input, 'resume');
    try {
      await entered.promise;
      expect(h.agent.prompt).not.toHaveBeenCalled();
      const disk = createMemorySessionIntentStore();
      for (const intent of structuredClone(intents.snapshot())) await disk.saveActive(intent);
      const restarted = makeAcpHarness({ intents: disk });
      const next = new AcpRuntime(restarted.deps);
      try {
        await next.reconcile();
        // A new, never-used provider session may not have been retained by the provider.
        restarted.agent.loadSession.mockRejectedValueOnce(
          Object.assign(new Error('missing'), {
            code: -32002,
            data: { uri: 'session-1' },
          })
        );
        expect((await next.startSession(input, 'resume')).success).toBe(true);
        await vi.waitFor(() => expect(restarted.agent.prompt).toHaveBeenCalledTimes(2));
        expect(restarted.agent.newSession).toHaveBeenCalledOnce();
      } finally {
        await next.dispose();
      }
    } finally {
      finish.resolve();
      await starting;
      await runtime.dispose();
    }
  });

  it.each([false, true])(
    'requires the trusted prompt payload when restoring pending work (materialized=%s)',
    async (materialized) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      let runtime = new AcpRuntime(h.deps);
      const fault = materialized
        ? vi
            .spyOn(SessionCell.prototype, 'queuePrompt')
            .mockReturnValueOnce(acpErr.invalidState('queue rejected'))
        : null;
      try {
        if (materialized) expect((await runtime.startSession(input, 'resume')).success).toBe(false);
        else await runtime.attachSession(input);
        await runtime.dispose();
        runtime = new AcpRuntime(h.deps);
        await runtime.reconcile();
        expect(
          await runtime.startSession({ ...input, initialQueue: undefined }, 'resume')
        ).toMatchObject({ success: false, error: { type: 'invalid_state' } });
        expect(h.agent.newSession).toHaveBeenCalledTimes(materialized ? 1 : 0);
        expect(intents.snapshot()[0]?.payload).toMatchObject({ initialQueueConsumed: false });
        expect((await runtime.startSession(input, 'resume')).success).toBe(true);
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
      } finally {
        fault?.mockRestore();
        await runtime.dispose();
      }
    }
  );

  it.each(['completed', 'provider failure'] as const)(
    'does not redeliver a consumed initial queue after restart (%s)',
    async (outcome) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      let runtime = new AcpRuntime(h.deps);
      if (outcome === 'provider failure')
        h.agent.prompt.mockRejectedValue(new Error('lost response'));
      try {
        expect((await runtime.startSession(input, 'resume')).success).toBe(true);
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
        await runtime.dispose();
        runtime = new AcpRuntime(h.deps);
        await runtime.reconcile();
        await runtime.attachSession(input);
        expect((await runtime.startSession(input, 'resume')).success).toBe(true);
        expect(h.agent.prompt).toHaveBeenCalledTimes(2);
      } finally {
        await runtime.dispose();
      }
    }
  );

  it('never treats a legacy intent as proof of an unconsumed queue', async () => {
    const intents = createMemorySessionIntentStore();
    const h = makeAcpHarness({ intents });
    let runtime = new AcpRuntime(h.deps);
    try {
      await runtime.attachSession(input);
      await runtime.dispose();
      const saved = intents.snapshot()[0]!;
      const { initialQueueConsumed: _removed, ...payload } = saved.payload as Record<
        string,
        Serializable
      >;
      await intents.saveActive({ ...saved, payload });
      runtime = new AcpRuntime(h.deps);
      await runtime.reconcile();
      expect((await runtime.startSession(input, 'resume')).success).toBe(true);
      expect(h.agent.prompt).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });
});
