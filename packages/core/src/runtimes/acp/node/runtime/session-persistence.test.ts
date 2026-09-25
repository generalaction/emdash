import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, type Serializable } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { emptyRetainedPresentation } from '#runtimes/acp/node/state/live-models';
import { createMemorySessionIntentStore } from '#services/session-intents/api';
import { createFileSessionIntentStore } from '#services/session-intents/node';
import { AcpRuntime } from './runtime';

const missing = (sessionId: string) =>
  Object.assign(new Error('Resource not found'), { code: -32002, data: { uri: sessionId } });

describe('ACP persistence boundaries', () => {
  it('preserves replay evidence across restart even if storage fails after history arrives', async () => {
    const intents = createMemorySessionIntentStore();
    const saveActive = intents.saveActive.bind(intents);
    const h = makeAcpHarness({ intents });
    let runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'partial-replay-write-failure' });
    let replayed = false;
    try {
      await runtime.startSession(input, 'fresh');
      await runtime.stopSession(input.conversationId);
      const save = vi
        .spyOn(intents, 'saveActive')
        .mockImplementation(async (intent) =>
          replayed ? err({ type: 'io', message: 'disk full' }) : saveActive(intent)
        );
      h.agent.loadSession.mockImplementationOnce(async () => {
        replayed = true;
        await h.client().sessionUpdate({
          sessionId: 'session-1',
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: 'Existing history' },
          },
        });
        throw missing('session-1');
      });
      expect((await runtime.startSession(input, 'resume')).success).toBe(false);
      expect(intents.snapshot()[0]?.payload).toMatchObject({ unstarted: false });
      await runtime.dispose();
      save.mockRestore();
      runtime = new AcpRuntime(h.deps);
      await runtime.reconcile();
      h.agent.loadSession.mockRejectedValueOnce(missing('session-1'));
      expect(await runtime.startSession(input, 'resume')).toMatchObject({
        success: false,
        error: { type: 'session_not_found' },
      });
      expect(h.agent.newSession).toHaveBeenCalledOnce();
      expect(intents.snapshot()[0]?.sessionId).toBe('session-1');
    } finally {
      await runtime.dispose();
    }
  });

  it('keeps the old pointer in memory and storage when saving a fresh session fails', async () => {
    const intents = createMemorySessionIntentStore();
    const saveActive = intents.saveActive.bind(intents);
    const h = makeAcpHarness({ intents });
    const runtime = new AcpRuntime(h.deps);
    const input = makeStartInput({ conversationId: 'fresh-write-failure', sessionId: 'saved' });
    try {
      await runtime.attachSession(input);
      vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) =>
        intent.sessionId === 'session-1'
          ? err({ type: 'io', message: 'disk full' })
          : saveActive(intent)
      );
      expect((await runtime.startSession(input, 'fresh')).success).toBe(false);
      expect(await runtime.attachSession(input)).toMatchObject({
        success: true,
        data: { sessionId: 'saved' },
      });
      expect(intents.snapshot()[0]?.sessionId).toBe('saved');
      expect((await runtime.startSession(input, 'resume')).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: 'saved' })
      );
    } finally {
      await runtime.dispose();
    }
  });

  it.each(['result', 'throw'] as const)(
    'does not call the provider when the replay barrier fails with %s',
    async (failure) => {
      const setup = await seededRuntime(true);
      const { h, runtime, input, intents } = setup;
      const originalSave = intents.saveActive.bind(intents);
      const save = vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
        if ((intent.payload as { unstarted: boolean }).unstarted === false) {
          if (failure === 'throw') throw new Error('disk full');
          return err({ type: 'io', message: 'disk full' });
        }
        return originalSave(intent);
      });
      try {
        expect((await runtime.startSession(input, 'resume')).success).toBe(false);
        expect(h.agent.loadSession).not.toHaveBeenCalled();
        expect(h.agent.newSession).not.toHaveBeenCalled();
        expect(intents.snapshot()[0]).toMatchObject({
          sessionId: 'saved',
          payload: { unstarted: true },
        });
        save.mockRestore();
        h.agent.loadSession.mockRejectedValueOnce(missing('saved'));
        expect((await runtime.startSession(input, 'resume')).success).toBe(true);
        expect(h.agent.newSession).toHaveBeenCalledOnce();
      } finally {
        await runtime.dispose();
      }
    }
  );

  for (const mode of ['fresh', 'resume'] as const) {
    for (const failure of ['once', 'persistent', 'throw'] as const) {
      it.each(['same worker', 'restarted worker'] as const)(
        `preserves identity and presentation after ${mode} persistence fails (${failure}, %s)`,
        async (retry) => {
          const { intents, h, input, runtime: first } = await seededRuntime(mode === 'resume');
          let runtime = first;
          const originalSave = intents.saveActive.bind(intents);
          let candidateWrites = 0;
          const save = vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
            if (intent.sessionId === 'session-1') {
              candidateWrites += 1;
              if (failure === 'throw') throw new Error('disk full');
              if (failure === 'persistent' || candidateWrites === 1) {
                return err({ type: 'io', message: 'disk full' });
              }
            }
            return originalSave(intent);
          });
          if (mode === 'resume') h.agent.loadSession.mockRejectedValueOnce(missing('saved'));
          try {
            expect((await runtime.startSession(input, mode)).success).toBe(false);
            // An attachment/background save after failure must not silently commit the candidate.
            expect(await runtime.attachSession(input)).toMatchObject({
              data: { sessionId: 'saved' },
            });
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(candidateWrites).toBe(1);
            expect(intents.snapshot()[0]).toMatchObject({
              sessionId: 'saved',
              payload: {
                presentation: { lastKnownMcpServers: [{ name: 'retained', transport: 'http' }] },
              },
            });
            expect(peek(runtime.sessionLiveModels(input.conversationId)!.source)).toMatchObject({
              kind: 'suspended',
              retained: { lastKnownMcpServers: [{ name: 'retained', transport: 'http' }] },
            });
            save.mockRestore();
            if (retry === 'restarted worker') {
              const restored = await copyIntents(intents);
              await runtime.dispose();
              runtime = new AcpRuntime({ ...h.deps, intents: restored });
              await runtime.reconcile();
            }
            expect((await runtime.startSession(input, 'resume')).success).toBe(true);
            expect(h.agent.loadSession).toHaveBeenLastCalledWith(
              expect.objectContaining({ sessionId: 'saved' })
            );
            expect(h.agent.newSession).toHaveBeenCalledOnce();
          } finally {
            await runtime.dispose();
          }
        }
      );
    }
  }

  it.each(['empty', 'partial', 'rebound'] as const)(
    'keeps the durable pointer safe if the worker dies during %s replay',
    async (replay) => {
      const { intents, h, runtime: first, input } = await seededRuntime(true);
      let runtime = first;
      const loading = deferred<void>();
      const finish = deferred<Record<string, never>>();
      h.agent.loadSession.mockImplementationOnce(async () => {
        if (replay !== 'empty') {
          await h.client().sessionUpdate({
            sessionId: replay === 'rebound' ? 'provisional' : 'saved',
            update: {
              sessionUpdate: 'user_message_chunk',
              content: { type: 'text', text: 'History' },
            },
          });
        }
        loading.resolve();
        return finish.promise;
      });
      const starting = runtime.startSession(input, 'resume');
      try {
        await loading.promise;
        // Clone only what was durable at the crash, before shutdown can flush anything else.
        const restartedIntents = await copyIntents(intents);
        expect(restartedIntents.snapshot()[0]).toMatchObject({
          sessionId: 'saved',
          payload: { unstarted: false },
        });
        finish.reject(new Error('worker crashed'));
        await starting;
        await runtime.dispose();
        runtime = new AcpRuntime({ ...h.deps, intents: restartedIntents });
        await runtime.reconcile();
        h.agent.loadSession.mockRejectedValueOnce(missing('saved'));
        expect(await runtime.startSession(input, 'resume')).toMatchObject({
          error: { type: 'session_not_found' },
        });
        expect(h.agent.newSession).not.toHaveBeenCalled();
        expect(restartedIntents.snapshot()[0]?.sessionId).toBe('saved');
      } finally {
        finish.resolve({});
        await starting;
        await runtime.dispose();
      }
    }
  );

  it.each([true, false])(
    'serializes background changes behind a pending replacement write (success: %s)',
    async (success) => {
      const { intents, h, runtime, input } = await seededRuntime(false);
      h.agent.newSession.mockResolvedValueOnce({
        sessionId: 'session-1',
        configOptions: [
          {
            id: 'model',
            name: 'Model',
            category: 'model',
            type: 'select',
            currentValue: 'old',
            options: [
              { value: 'old', name: 'Old' },
              { value: 'changed-while-saving', name: 'Changed' },
            ],
          },
        ],
      });
      const entered = deferred<void>();
      const finish = deferred<void>();
      const originalSave = intents.saveActive.bind(intents);
      const writes: Array<string | null | undefined> = [];
      vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
        writes.push(intent.sessionId);
        if (
          intent.sessionId === 'session-1' &&
          writes.filter((id) => id === 'session-1').length === 1
        ) {
          entered.resolve();
          await finish.promise;
          if (!success) return err({ type: 'io', message: 'disk full' });
        }
        return originalSave(intent);
      });
      const starting = runtime.startSession(input, 'fresh');
      try {
        await entered.promise;
        expect(await runtime.attachSession(input)).toMatchObject({ data: { sessionId: 'saved' } });
        expect(intents.snapshot()[0]?.sessionId).toBe('saved');
        await runtime.setOption(input.conversationId, 'model', 'changed-while-saving');
        finish.resolve();
        expect((await starting).success).toBe(success);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(intents.snapshot()[0]).toMatchObject({
          sessionId: success ? 'session-1' : 'saved',
          payload: { configured: { model: 'changed-while-saving' } },
        });
        expect(writes.slice(writes.indexOf('session-1') + 1)).not.toContain(
          success ? 'saved' : 'session-1'
        );
        expect(await runtime.attachSession(input)).toMatchObject({
          data: { sessionId: success ? 'session-1' : 'saved' },
        });
        if (success)
          expect(h.agent.setSessionConfigOption).toHaveBeenCalledWith({
            sessionId: 'session-1',
            configId: 'model',
            value: 'changed-while-saving',
          });
        expect(h.agent.prompt).not.toHaveBeenCalled();
      } finally {
        finish.resolve();
        await starting;
        await runtime.dispose();
      }
    }
  );

  it.each(['empty', 'initial queue'] as const)(
    'does not adopt a first session whose intent cannot be written (%s)',
    async (kind) => {
      const intents = createMemorySessionIntentStore();
      const h = makeAcpHarness({ intents });
      const runtime = new AcpRuntime(h.deps);
      const input = makeStartInput({
        conversationId: 'first-write',
        initialQueue: kind === 'initial queue' ? [{ text: 'hello' }] : undefined,
      });
      const save = vi
        .spyOn(intents, 'saveActive')
        .mockResolvedValue(err({ type: 'io', message: 'disk full' }));
      try {
        expect((await runtime.startSession(input, 'fresh')).success).toBe(false);
        expect(await runtime.attachSession(input)).toMatchObject({ data: { sessionId: null } });
        expect(h.agent.prompt).not.toHaveBeenCalled();
        expect(intents.snapshot()).toEqual([]);
        save.mockRestore();
        expect((await runtime.startSession(input, 'fresh')).success).toBe(true);
        expect(h.agent.newSession).toHaveBeenCalledTimes(2);
        if (kind === 'initial queue')
          await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
      } finally {
        await runtime.dispose();
      }
    }
  );

  it.each(['empty', 'partial', 'rebound'] as const)(
    'preserves the previous pointer if committing a completed %s replay fails',
    async (replay) => {
      const { intents, h, runtime: first, input } = await seededRuntime(true);
      let runtime = first;
      let replayFinished = false;
      const originalSave = intents.saveActive.bind(intents);
      const save = vi
        .spyOn(intents, 'saveActive')
        .mockImplementation(async (intent) =>
          replayFinished ? err({ type: 'io', message: 'disk full' }) : originalSave(intent)
        );
      h.agent.loadSession.mockImplementationOnce(async () => {
        if (replay !== 'empty') {
          await h.client().sessionUpdate({
            sessionId: replay === 'rebound' ? 'rebound' : 'saved',
            update: {
              sessionUpdate: 'user_message_chunk',
              content: { type: 'text', text: 'History' },
            },
          });
        }
        replayFinished = true;
        return {};
      });
      try {
        expect((await runtime.startSession(input, 'resume')).success).toBe(false);
        expect(await runtime.attachSession(input)).toMatchObject({ data: { sessionId: 'saved' } });
        const restored = await copyIntents(intents);
        expect(restored.snapshot()[0]).toMatchObject({
          sessionId: 'saved',
          payload: { unstarted: false },
        });
        await runtime.dispose();
        save.mockRestore();
        runtime = new AcpRuntime({ ...h.deps, intents: restored });
        await runtime.reconcile();
        h.agent.loadSession.mockRejectedValueOnce(missing('saved'));
        expect(await runtime.startSession(input, 'resume')).toMatchObject({
          error: { type: 'session_not_found' },
        });
        expect(h.agent.newSession).not.toHaveBeenCalled();
      } finally {
        await runtime.dispose();
      }
    }
  );

  for (const operation of ['stop', 'terminate'] as const) {
    it.each([true, false])(
      `orders ${operation} after an in-flight replacement commit (success: %s)`,
      async (success) => {
        const { intents, h, runtime, input } = await seededRuntime(false);
        const entered = deferred<void>();
        const finish = deferred<void>();
        const originalSave = intents.saveActive.bind(intents);
        vi.spyOn(intents, 'saveActive').mockImplementation(async (intent) => {
          if (intent.sessionId === 'session-1') {
            entered.resolve();
            await finish.promise;
            if (!success) return err({ type: 'io', message: 'disk full' });
          }
          return originalSave(intent);
        });
        const starting = runtime.startSession(input, 'fresh');
        try {
          await entered.promise;
          const stopping =
            operation === 'stop'
              ? runtime.stopSession(input.conversationId)
              : runtime.terminateSession(input.conversationId);
          await new Promise<void>((resolve) => setImmediate(resolve));
          finish.resolve();
          await Promise.all([starting, stopping]);
          await new Promise<void>((resolve) => setImmediate(resolve));
          expect(h.agent.prompt).not.toHaveBeenCalled();
          if (operation === 'terminate') {
            expect(intents.snapshot()).toEqual([]);
            expect(runtime.getSessionState(input.conversationId).lifecycle).toBe('closed');
          } else {
            expect(intents.snapshot()[0]).toMatchObject({
              status: 'suspended',
              sessionId: success ? 'session-1' : 'saved',
            });
            expect(await runtime.attachSession(input)).toMatchObject({
              data: { sessionId: success ? 'session-1' : 'saved' },
            });
          }
        } finally {
          finish.resolve();
          await starting;
          await runtime.dispose();
        }
      }
    );
  }

  it('preserves the pointer through a real file write failure and store restart', async () => {
    const { intents, h, runtime: seed, input } = await seededRuntime(false);
    const directory = await mkdtemp(join(tmpdir(), 'emdash-acp-persistence-'));
    const path = join(directory, 'intents.json');
    const file = createFileSessionIntentStore({ path, scope: 'acp' });
    await file.saveActive(intents.snapshot()[0]!);
    await seed.dispose();
    let runtime = new AcpRuntime({ ...h.deps, intents: file });
    try {
      await runtime.reconcile();
      const temporaryPath = `${path}.${process.pid}.tmp`;
      await mkdir(temporaryPath);
      expect((await runtime.startSession(input, 'fresh')).success).toBe(false);
      await rm(temporaryPath, { recursive: true });
      expect(await runtime.attachSession(input)).toMatchObject({ data: { sessionId: 'saved' } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await runtime.dispose();
      runtime = new AcpRuntime({
        ...h.deps,
        intents: createFileSessionIntentStore({ path, scope: 'acp' }),
      });
      await runtime.reconcile();
      expect((await runtime.startSession(input, 'resume')).success).toBe(true);
      expect(h.agent.loadSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ sessionId: 'saved' })
      );
      expect(h.agent.newSession).toHaveBeenCalledOnce();
    } finally {
      await runtime.dispose();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function seededRuntime(unstarted: boolean) {
  const intents = createMemorySessionIntentStore();
  const input = makeStartInput({ conversationId: 'persisted', sessionId: 'saved' });
  const configured = { model: null, modeId: null, effort: null, collaborationMode: null };
  const presentation = {
    ...emptyRetainedPresentation(configured),
    lastKnownMcpServers: [{ name: 'retained', transport: 'http' }],
  };
  await intents.saveActive({
    conversationId: input.conversationId,
    sessionId: 'saved',
    payload: {
      version: '1',
      conversationId: input.conversationId,
      providerId: input.providerId,
      cwd: input.cwd,
      sessionId: 'saved',
      unstarted,
      configured,
      presentation,
    } as unknown as Serializable,
  });
  const h = makeAcpHarness({ intents });
  const runtime = new AcpRuntime(h.deps);
  await runtime.reconcile();
  return { intents, h, runtime, input };
}

async function copyIntents(intents: ReturnType<typeof createMemorySessionIntentStore>) {
  const restored = createMemorySessionIntentStore();
  for (const intent of structuredClone(intents.snapshot())) await restored.saveActive(intent);
  return restored;
}
