import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { CloseSessionRequest, PromptRequest, PromptResponse } from '@agentclientprotocol/sdk';
import { ok } from '@emdash/shared';
import { noopLogger } from '@emdash/shared/logger';
import { deferred } from '@emdash/shared/testing';
import { peek } from '@emdash/wire/state';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { AcpRuntime } from './runtime';

const VICTIM = 'victim';
const SIBLING = 'sibling';
const LONG_TURN = { type: 'text', text: 'long turn' } as const;

type PendingTurn = 'initial prompt' | 'drained queued prompt' | 'typed follow-up';

describe('ACP teardown while a provider prompt is pending', () => {
  it.each([
    { turn: 'initial prompt', close: 'times out', settlement: 'resolves' },
    { turn: 'initial prompt', close: 'fails', settlement: 'rejects' },
    { turn: 'drained queued prompt', close: 'times out', settlement: 'resolves' },
    { turn: 'typed follow-up', close: 'times out', settlement: 'rejects' },
  ] as const)(
    'kills a $turn whose close $close and whose provider result $settlement late',
    async ({ turn, close, settlement }) => {
      const unhandled = recordUnhandledRejections();
      const { h, rt, logger, lateTurn, closing } = makeTeardownHarness(close);
      try {
        await rt.startSession(makeStartInput({ conversationId: SIBLING }), 'resume');
        await startVictimTurn(rt, turn);
        await vi.waitFor(() =>
          expect(h.agent.prompt).toHaveBeenCalledWith({
            sessionId: 'victim-session',
            prompt: [LONG_TURN],
          })
        );

        await expect(rt.terminateSession(VICTIM)).resolves.toEqual(ok());
        if (settlement === 'resolves') lateTurn.resolve({ stopReason: 'cancelled' });
        else lateTurn.reject(new Error('connection closed'));
        await new Promise((resolve) => setImmediate(resolve));

        expect(unhandled).toEqual([]);
        expect(logger.error).not.toHaveBeenCalled();
        await expectSiblingUsable(rt, h);
      } finally {
        closing.resolve();
        lateTurn.resolve({ stopReason: 'cancelled' });
        await rt.dispose();
      }
    }
  );

  it('keeps repeated teardown bounded before the provider answers late', async () => {
    const unhandled = recordUnhandledRejections();
    const { h, rt, logger, lateTurn, closing } = makeTeardownHarness('times out');
    try {
      await rt.startSession(makeStartInput({ conversationId: SIBLING }), 'resume');
      await startVictimTurn(rt, 'initial prompt');
      await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());

      await expect(
        Promise.all([
          rt.stopSession(VICTIM),
          rt.terminateSession(VICTIM),
          rt.terminateSession(VICTIM),
        ])
      ).resolves.toEqual([ok(), ok(), ok()]);
      lateTurn.resolve({ stopReason: 'cancelled' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      expect(logger.error).not.toHaveBeenCalled();
      await expectSiblingUsable(rt, h);
    } finally {
      closing.resolve();
      lateTurn.resolve({ stopReason: 'cancelled' });
      await rt.dispose();
    }
  });

  it('keeps a stale prompt result out of the replacement activation', async () => {
    const unhandled = recordUnhandledRejections();
    const h = makeAcpHarness();
    const lateTurn = deferred<PromptResponse>();
    h.agent.prompt.mockReturnValueOnce(lateTurn.promise);
    const rt = new AcpRuntime(h.deps);
    try {
      await rt.startSession(
        makeStartInput({ conversationId: VICTIM, initialQueue: [{ text: LONG_TURN.text }] }),
        'resume'
      );
      await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledOnce());
      await rt.stopSession(VICTIM);
      await rt.startSession(makeStartInput({ conversationId: VICTIM }), 'resume');
      expect(h.agent.loadSession).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: 'session-1' })
      );
      const replacement = peek(rt.sessionLiveModels(VICTIM)!.source);

      lateTurn.resolve({ stopReason: 'cancelled' });
      await new Promise((resolve) => setImmediate(resolve));

      expect(unhandled).toEqual([]);
      expect(peek(rt.sessionLiveModels(VICTIM)!.source)).toEqual(replacement);
    } finally {
      lateTurn.resolve({ stopReason: 'cancelled' });
      await rt.dispose();
    }
  });

  it('keeps the worker process alive when a killed initial prompt answers late', async () => {
    const { exitCode, stdout, stderr } = await runLatePromptWorker();
    expect(exitCode, stderr).toBe(0);
    expect(JSON.parse(stdout)).toEqual({
      unhandledRejectionListeners: 0,
      siblingStopReason: 'end_turn',
    });
  }, 20_000);
});

/** The test runner intercepts unhandled rejections that would terminate the ACP worker. */
function recordUnhandledRejections(): unknown[] {
  const reasons: unknown[] = [];
  const record = (reason: unknown) => {
    reasons.push(reason);
  };
  process.on('unhandledRejection', record);
  onTestFinished(() => {
    process.off('unhandledRejection', record);
  });
  return reasons;
}

function makeTeardownHarness(close: 'times out' | 'fails') {
  const logger = { ...noopLogger, error: vi.fn() };
  const h = makeAcpHarness({ logger, lifecycle: { activationDrainTimeoutMs: 20 } });
  const lateTurn = deferred<PromptResponse>();
  const closing = deferred<void>();
  h.agent.newSession
    .mockResolvedValueOnce({ sessionId: 'sibling-session' })
    .mockResolvedValueOnce({ sessionId: 'victim-session' });
  h.agent.prompt.mockImplementation(async (request: PromptRequest) =>
    request.prompt.some((block) => block.type === 'text' && block.text === LONG_TURN.text)
      ? lateTurn.promise
      : { stopReason: 'end_turn' }
  );
  h.agent.closeSession.mockImplementation(async ({ sessionId }: CloseSessionRequest) => {
    if (sessionId !== 'victim-session') return {};
    if (close === 'fails') throw new Error('close failed');
    await closing.promise;
    return {};
  });
  return { h, rt: new AcpRuntime(h.deps), logger, lateTurn, closing };
}

async function startVictimTurn(rt: AcpRuntime, turn: PendingTurn): Promise<void> {
  const initialQueue =
    turn === 'initial prompt'
      ? [{ text: LONG_TURN.text }]
      : turn === 'drained queued prompt'
        ? [{ text: 'quick turn' }, { text: LONG_TURN.text }]
        : undefined;
  await rt.startSession(makeStartInput({ conversationId: VICTIM, initialQueue }), 'resume');
  if (turn === 'typed follow-up') await rt.sendPrompt(VICTIM, { text: LONG_TURN.text });
}

async function expectSiblingUsable(
  rt: AcpRuntime,
  h: ReturnType<typeof makeAcpHarness>
): Promise<void> {
  await expect(rt.sendPrompt(SIBLING, { text: 'still there?' })).resolves.toEqual(
    ok({ queued: false })
  );
  await vi.waitFor(() =>
    expect(rt.getSessionState(SIBLING)).toMatchObject({
      isGenerating: false,
      lastStopReason: 'end_turn',
    })
  );
  expect(h.children).toHaveLength(1);
  expect(h.lastChild.kill).not.toHaveBeenCalled();
}

function runLatePromptWorker(): Promise<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolve) => {
    const child = execFile(
      process.execPath,
      [
        '--conditions=development',
        '--import',
        'tsx',
        fileURLToPath(new URL('./test/fixtures/late-prompt-worker.ts', import.meta.url)),
      ],
      { timeout: 15_000 },
      (_error, stdout, stderr) => resolve({ exitCode: child.exitCode, stdout, stderr })
    );
  });
}
