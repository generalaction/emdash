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
    it.each(['provider creation', 'pointer write', 'dispatch write'] as const)(
      `keeps pending prompts retryable after fresh %s fails (${retry})`,
      async (failure) => {
        const intents = createMemorySessionIntentStore();
        const h = makeAcpHarness({ intents });
        let runtime = new AcpRuntime(h.deps);
        const queueFault = vi
          .spyOn(SessionCell.prototype, 'queuePrompt')
          .mockReturnValueOnce(acpErr.invalidState('initial startup failed'));
        const originalSave = intents.saveActive.bind(intents);
        const save = vi.spyOn(intents, 'saveActive');
        try {
          expect((await runtime.startSession(input, 'resume')).success).toBe(false);
          if (failure === 'provider creation') {
            h.agent.newSession.mockRejectedValueOnce(new Error('provider unavailable'));
          } else {
            h.agent.newSession.mockResolvedValueOnce({ sessionId: 'provisional' });
            save.mockImplementation(async (intent) => {
              const consumed = (intent.payload as { initialQueueConsumed: boolean })
                .initialQueueConsumed;
              if (intent.sessionId === 'provisional' && (failure === 'pointer write' || consumed)) {
                return err({ type: 'io', message: 'disk full' });
              }
              return originalSave(intent);
            });
          }
          expect((await runtime.startSession(input, 'fresh')).success).toBe(false);
          expect(h.agent.prompt).not.toHaveBeenCalled();
          expect(intents.snapshot()[0]).toMatchObject({
            sessionId: failure === 'dispatch write' ? 'provisional' : 'session-1',
            payload: { initialQueueConsumed: false },
          });
          save.mockRestore();
          if (retry === 'restarted worker') {
            await runtime.dispose();
            runtime = new AcpRuntime(h.deps);
            await runtime.reconcile();
          }
          h.agent.newSession.mockResolvedValueOnce({ sessionId: 'replacement' });
          expect((await runtime.startSession(input, 'fresh')).success).toBe(true);
          await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
          expect(h.agent.prompt.mock.calls.map(([request]) => request.sessionId)).toEqual([
            'replacement',
            'replacement',
          ]);
          expect(h.agent.loadSession).not.toHaveBeenCalled();
          expect(intents.snapshot()[0]).toMatchObject({
            sessionId: 'replacement',
            payload: { initialQueueConsumed: true },
          });
          await runtime.stopSession(input.conversationId);
          expect((await runtime.startSession(input, 'fresh')).success).toBe(true);
          expect(h.agent.prompt).toHaveBeenCalledTimes(2);
        } finally {
          queueFault.mockRestore();
          save.mockRestore();
          await runtime.dispose();
        }
      }
    );

    it.each([
      { failure: 'result', mode: 'resume' },
      { failure: 'throw', mode: 'resume' },
      { failure: 'result', mode: 'fresh' },
      { failure: 'throw', mode: 'fresh' },
    ] as const)(
      `retains prepared prompts after a failed dispatch commit ($failure, $mode, ${retry})`,
      async ({ failure, mode }) => {
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
          if (mode === 'fresh')
            h.agent.newSession.mockResolvedValueOnce({ sessionId: 'replacement' });
          expect((await runtime.startSession(input, mode)).success).toBe(true);
          await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
          expect(h.agent.newSession).toHaveBeenCalledTimes(mode === 'fresh' ? 2 : 1);
          expect(h.agent.loadSession).toHaveBeenCalledTimes(mode === 'resume' ? 1 : 0);
          expect(h.agent.prompt.mock.calls.map(([request]) => request.sessionId)).toEqual([
            mode === 'fresh' ? 'replacement' : 'session-1',
            mode === 'fresh' ? 'replacement' : 'session-1',
          ]);
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

  it.each([
    { failure: 'second queue entry', mode: 'resume' },
    { failure: 'readiness after transition', mode: 'resume' },
    { failure: 'second queue entry', mode: 'fresh' },
    { failure: 'readiness after transition', mode: 'fresh' },
  ] as const)(
    'does not dispatch a partially prepared queue when $failure fails before $mode retry',
    async ({ failure, mode }) => {
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
        expect((await runtime.startSession(input, mode)).success).toBe(true);
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

  it.each([
    { materialized: false, mode: 'resume' },
    { materialized: true, mode: 'resume' },
    { materialized: false, mode: 'fresh' },
    { materialized: true, mode: 'fresh' },
  ] as const)(
    'requires the trusted prompt payload when restoring pending work (materialized=$materialized, mode=$mode)',
    async ({ materialized, mode }) => {
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
          await runtime.startSession({ ...input, initialQueue: undefined }, mode)
        ).toMatchObject({ success: false, error: { type: 'invalid_state' } });
        expect(h.agent.newSession).toHaveBeenCalledTimes(materialized ? 1 : 0);
        expect(intents.snapshot()[0]?.payload).toMatchObject({ initialQueueConsumed: false });
        expect((await runtime.startSession(input, mode)).success).toBe(true);
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
      } finally {
        fault?.mockRestore();
        await runtime.dispose();
      }
    }
  );

  it.each([
    { outcome: 'completed', mode: 'resume' },
    { outcome: 'provider failure', mode: 'resume' },
    { outcome: 'completed', mode: 'fresh' },
    { outcome: 'provider failure', mode: 'fresh' },
  ] as const)(
    'does not redeliver a consumed initial queue after restart ($outcome, $mode)',
    async ({ outcome, mode }) => {
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
        expect((await runtime.startSession(input, mode)).success).toBe(true);
        expect(h.agent.prompt).toHaveBeenCalledTimes(2);
      } finally {
        await runtime.dispose();
      }
    }
  );

  it.each(['resume', 'fresh'] as const)(
    'never treats a legacy intent as proof of an unconsumed queue (%s)',
    async (mode) => {
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
        await intents.saveActive({
          ...saved,
          sessionId: 'legacy-session',
          payload: { ...payload, sessionId: 'legacy-session' },
        });
        runtime = new AcpRuntime(h.deps);
        await runtime.reconcile();
        expect((await runtime.startSession(input, mode)).success).toBe(true);
        expect(h.agent.prompt).not.toHaveBeenCalled();
      } finally {
        await runtime.dispose();
      }
    }
  );
});
