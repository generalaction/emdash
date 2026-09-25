import { randomUUID } from 'node:crypto';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { createScope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import { observe, remote, snapshot } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acpApiContract, type StopReason, type TranscriptTurn } from '#runtimes/acp/api';
import { makeAcpHarness, makeStartInput } from '#runtimes/acp/node/acp-test-support';
import { createAcpController } from '#runtimes/acp/node/api/controller';
import { AcpRuntime } from './runtime';

async function createHarness() {
  const provider = makeAcpHarness();
  const runtime = new AcpRuntime(provider.deps);
  const wire = createTestWire(acpApiContract, createAcpController(runtime));
  const models = remote(acpApiContract.session, wire.client.session);
  const scope = createScope();
  const conversationId = 'transcript-continuity';
  const launched = await wire.client.startSession({
    ...makeStartInput({ conversationId }),
    mode: 'resume',
  });
  if (!launched.success) throw new Error('Could not launch test conversation');
  const session = models({ conversationId });
  const observed: Array<TranscriptTurn | null> = [];
  observe(
    session.states.activeTurn,
    (next) => {
      if (next.value !== undefined) observed.push(structuredClone(next.value));
    },
    { scope }
  );
  await session.states.activeTurn.refresh();
  const gates: Array<ReturnType<typeof deferred<{ stopReason: StopReason }>>> = [];
  return {
    provider,
    runtime,
    client: wire.client,
    conversationId,
    session,
    observed,
    get active() {
      return snapshot(session.states.activeTurn).value;
    },
    gate() {
      const gate = deferred<{ stopReason: StopReason }>();
      gates.push(gate);
      provider.agent.prompt.mockReturnValueOnce(gate.promise);
      return gate;
    },
    send(text: string, promptId = randomUUID(), placement?: 'auto' | 'queue') {
      return wire.client.sendPrompt({ conversationId, promptId, prompt: { text }, placement });
    },
    update(update: SessionUpdate) {
      return provider.client().sessionUpdate({ sessionId: launched.data.sessionId, update });
    },
    async history(before?: number, limit = 100) {
      const result = await wire.client.loadHistory({ conversationId, before, limit });
      if (!result.success) throw new Error(`History failed: ${result.error.type}`);
      return result.data;
    },
    async dispose() {
      for (const gate of gates) gate.resolve({ stopReason: 'end_turn' });
      await scope.dispose();
      await models.dispose();
      wire.dispose();
      await runtime.dispose();
    },
  };
}

let h: Awaited<ReturnType<typeof createHarness>>;
afterEach(async () => {
  await h?.dispose();
});
const messageTexts = (turn: TranscriptTurn) =>
  turn.items.flatMap((item) => (item.kind === 'message' ? [item.text] : []));

describe('completed history through real runtime and Wire', () => {
  it('publishes a coherent transcript position across streaming, queue handoff and reconnect', async () => {
    h = await createHarness();
    await h.session.states.state.refresh();
    const initial = snapshot(h.session.states.state).value?.transcript;
    expect(initial).toMatchObject({
      historyRevision: 0,
      lastCommittedTurnSeq: null,
      activeTurn: null,
    });
    const first = h.gate();
    h.gate();
    await h.send('first');
    await vi.waitFor(() =>
      expect(snapshot(h.session.states.state).value?.transcript?.activeTurn).toBeTruthy()
    );
    await h.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'response' },
    });
    await h.send('second');
    expect(snapshot(h.session.states.state).value?.transcript?.historyRevision).toBe(0);
    first.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(() =>
      expect(snapshot(h.session.states.state).value?.transcript?.historyRevision).toBe(1)
    );
    const head = snapshot(h.session.states.state).value?.transcript;
    expect(head).toMatchObject({
      generation: initial?.generation,
      historyRevision: 1,
      lastCommittedTurnSeq: 0,
      activeTurn: { seq: 1 },
    });
    const page = await h.history();
    expect(page.position).toEqual({
      generation: head?.generation,
      historyRevision: 1,
      lastCommittedTurnSeq: 0,
    });
    expect(page.coverage).toEqual({ fromSeq: null, beforeSeq: null });
    await h.client.attach(makeStartInput({ conversationId: h.conversationId }));
    await h.session.states.state.refresh();
    expect(snapshot(h.session.states.state).value?.transcript?.generation).toBe(
      initial?.generation
    );
  });

  it.each([
    'end_turn',
    'max_tokens',
    'max_turn_requests',
    'refusal',
    'cancelled',
    'error',
  ] as const)(
    'retains the prior prompt and final response while the queued turn runs after %s',
    async (reason) => {
      h = await createHarness();
      const first = h.gate();
      h.gate();
      const firstId = randomUUID();
      const secondId = randomUUID();
      await expect(h.send('first', firstId)).resolves.toMatchObject({
        success: true,
        data: { queued: false },
      });
      await h.update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'partial' },
      });
      await vi.waitFor(() => expect(h.active?.items).toHaveLength(2));
      await expect(h.send('second', secondId)).resolves.toMatchObject({
        success: true,
        data: { queued: true },
      });
      await h.update({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: ' final' },
      });
      if (reason === 'error') first.reject(new Error('provider failed'));
      else first.resolve({ stopReason: reason });
      await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(2));
      const history = await h.history();
      expect(history.turns).toHaveLength(1);
      expect(messageTexts(history.turns[0])).toEqual(['first', 'partial final']);
      expect(history.turns[0].items[0]).toMatchObject({ promptId: firstId });
      expect(history.turns[0].outcome?.kind).toBe(
        reason === 'error' ? 'error' : reason === 'cancelled' ? 'cancelled' : 'done'
      );
      await vi.waitFor(() =>
        expect(h.active?.items[0]).toMatchObject({ text: 'second', promptId: secondId })
      );
      expect(h.active?.id).not.toBe(history.turns[0].id);
    }
  );

  it.each([2, 5, 12])(
    'retains every distinct repeated-text prompt across a queue of %i',
    async (count) => {
      h = await createHarness();
      const gates = Array.from({ length: count }, () => h.gate());
      const ids = Array.from({ length: count }, () => randomUUID());
      for (const id of ids) expect((await h.send('continue', id)).success).toBe(true);
      for (let index = 0; index < count; index++) {
        await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(index + 1));
        await h.update({
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `response ${index}` },
        });
        gates[index].resolve({ stopReason: 'end_turn' });
        await vi.waitFor(async () => expect((await h.history()).turns).toHaveLength(index + 1));
      }
      const turns = (await h.history()).turns;
      expect(turns.map((turn) => turn.seq)).toEqual(ids.map((_, index) => index));
      expect(turns.map((turn) => turn.items[0])).toEqual(
        ids.map((promptId) => expect.objectContaining({ text: 'continue', promptId }))
      );
      expect(new Set(turns.flatMap((turn) => turn.items.map((item) => item.id))).size).toBe(
        count * 2
      );
    }
  );

  it('does not depend on receiving an idle snapshot between queued turns', async () => {
    h = await createHarness();
    const first = h.gate();
    h.gate();
    await h.send('first');
    await vi.waitFor(() => expect(h.active).not.toBeNull());
    const previousId = h.active?.id;
    await h.send('next');
    const observedBefore = h.observed.length;
    first.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(() => expect(h.active?.id).not.toBe(previousId));
    expect(h.observed.slice(observedBefore)).not.toContain(null);
    expect((await h.history()).turns[0].id).toBe(previousId);
  });

  it.each(['edit', 'delete', 'reorder'] as const)(
    'preserves dispatch identity and ordering after queued-prompt %s',
    async (operation) => {
      h = await createHarness();
      const first = h.gate();
      const next = h.gate();
      const last = h.gate();
      await h.send('running');
      const b = randomUUID();
      const c = randomUUID();
      await h.send('B', b);
      await h.send('C', c);
      const key = { conversationId: h.conversationId };
      if (operation === 'edit')
        expect(
          (await h.client.editQueuedPrompt({ ...key, id: b, input: { text: 'B edited' } })).success
        ).toBe(true);
      if (operation === 'delete')
        expect((await h.client.deleteQueuedPrompt({ ...key, id: b })).success).toBe(true);
      if (operation === 'reorder')
        expect((await h.client.changeQueuePromptOrder({ ...key, ids: [c, b] })).success).toBe(true);
      first.resolve({ stopReason: 'end_turn' });
      await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(2));
      next.resolve({ stopReason: 'end_turn' });
      if (operation !== 'delete')
        await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(3));
      last.resolve({ stopReason: 'end_turn' });
      const expected =
        operation === 'delete'
          ? ['running', 'C']
          : operation === 'edit'
            ? ['running', 'B edited', 'C']
            : ['running', 'C', 'B'];
      await vi.waitFor(async () =>
        expect((await h.history()).turns.map((turn) => messageTexts(turn)[0])).toEqual(expected)
      );
      const expectedIds = operation === 'delete' ? [c] : operation === 'edit' ? [b, c] : [c, b];
      expect((await h.history()).turns.slice(1).map((turn) => turn.items[0])).toEqual(
        expectedIds.map((promptId) => expect.objectContaining({ promptId }))
      );
    }
  );

  it('dispatches queue placement immediately if the conversation has become idle', async () => {
    h = await createHarness();
    const completion = h.gate();
    const id = randomUUID();
    // This is the existing runtime contract: queue placement must not strand a prompt
    // if the previous turn finishes before the request reaches the host.
    expect(await h.send('queued', id, 'queue')).toMatchObject({
      success: true,
      data: { queued: false },
    });
    expect((await h.history()).turns).toHaveLength(0);
    expect(h.provider.agent.prompt).toHaveBeenCalledOnce();
    expect(h.runtime.getSessionState(h.conversationId).queuedPrompts).toEqual([]);
    completion.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(async () =>
      expect((await h.history()).turns[0].items[0]).toMatchObject({ promptId: id, text: 'queued' })
    );
  });

  it.each([1, 2, 5, 100])(
    'paginates committed turns in order without duplicating an active turn, page size %i',
    async (limit) => {
      h = await createHarness();
      for (let index = 0; index < 7; index++) {
        await h.send(`turn ${index}`);
        await vi.waitFor(async () => expect((await h.history()).turns).toHaveLength(index + 1));
      }
      h.gate();
      await h.send('still running');
      const all: TranscriptTurn[] = [];
      let before: number | undefined;
      do {
        const page = await h.history(before, limit);
        all.unshift(...page.turns);
        before = page.nextCursor ?? undefined;
      } while (before !== undefined);
      expect(all.map((turn) => messageTexts(turn)[0])).toEqual(
        Array.from({ length: 7 }, (_, index) => `turn ${index}`)
      );
      expect(new Set(all.map((turn) => turn.id)).size).toBe(7);
    }
  );

  it.each([false, true])(
    'waits for the original prompt to settle before dispatching after cancel, cancellation rejected: %s',
    async (rejectCancel) => {
      h = await createHarness();
      const first = h.gate();
      h.gate();
      await h.send('first');
      await h.send('next');
      if (rejectCancel) h.provider.agent.cancel.mockRejectedValueOnce(new Error('cancel failed'));
      expect((await h.client.cancelTurn({ conversationId: h.conversationId })).success).toBe(
        !rejectCancel
      );
      expect(h.provider.agent.prompt).toHaveBeenCalledOnce();
      expect((await h.history()).turns).toHaveLength(0);
      expect(h.runtime.getSessionState(h.conversationId).queuedPrompts).toHaveLength(1);
      first.resolve({ stopReason: 'cancelled' });
      await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(2));
      expect((await h.history()).turns[0]).toMatchObject({
        outcome: { kind: 'cancelled' },
        items: [{ text: 'first' }],
      });
    }
  );

  it('amends a completed tool in its original turn while a queued turn is running', async () => {
    h = await createHarness();
    const first = h.gate();
    h.gate();
    await h.send('first');
    await h.update({
      sessionUpdate: 'tool_call',
      toolCallId: 'background-tool',
      title: 'Run a check',
      kind: 'execute',
      status: 'in_progress',
    });
    await h.send('next');
    first.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(2));
    const activeId = h.active?.id;
    await h.update({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'background-tool',
      status: 'completed',
    });
    const history = await h.history();
    expect(history.turns).toHaveLength(1);
    expect(
      history.turns[0].items.find(
        (item) => 'toolCallId' in item && item.toolCallId === 'background-tool'
      )
    ).toMatchObject({ status: 'done' });
    await vi.waitFor(() => expect(h.active?.id).toBe(activeId));
    expect(h.runtime.getSessionState(h.conversationId).historyRevision).toBeGreaterThan(0);
  });

  it.each([false, true])(
    'retains attachment metadata and prompt identity when queued: %s',
    async (queued) => {
      h = await createHarness();
      const first = queued ? h.gate() : null;
      if (queued) await h.send('running');
      const completion = h.gate();
      const promptId = randomUUID();
      const result = await h.client.sendPrompt({
        conversationId: h.conversationId,
        promptId,
        prompt: {
          text: '',
          attachments: [
            { type: 'attachment', id: 'image-1', mimeType: 'image/png', name: 'screenshot.png' },
          ],
        },
      });
      expect(result).toMatchObject({ success: true, data: { queued } });
      first?.resolve({ stopReason: 'end_turn' });
      await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(queued ? 2 : 1));
      completion.resolve({ stopReason: 'end_turn' });
      await vi.waitFor(async () => expect((await h.history()).turns).toHaveLength(queued ? 2 : 1));
      expect((await h.history()).turns.at(-1)?.items[0]).toMatchObject({
        promptId,
        text: '',
        attachments: [{ id: 'image-1', name: 'screenshot.png', mimeType: 'image/png' }],
      });
    }
  );

  it('rejects unreadable attachments before acceptance without creating a phantom turn', async () => {
    h = await createHarness();
    vi.mocked(h.provider.deps.resolveAttachment).mockRejectedValueOnce(
      new Error('attachment missing')
    );
    const result = await h.client.sendPrompt({
      conversationId: h.conversationId,
      promptId: randomUUID(),
      prompt: {
        text: 'Inspect',
        attachments: [{ type: 'attachment', id: 'missing', mimeType: 'image/png' }],
      },
    });
    expect(result.success).toBe(false);
    expect(h.provider.agent.prompt).not.toHaveBeenCalled();
    expect((await h.history()).turns).toEqual([]);
    expect(h.runtime.getSessionState(h.conversationId).queuedPrompts).toEqual([]);
  });

  it('records a queued attachment failure as its own turn and continues the remaining queue', async () => {
    h = await createHarness();
    const running = h.gate();
    const last = h.gate();
    await h.send('running');
    const attachmentId = randomUUID();
    vi.mocked(h.provider.deps.resolveAttachment)
      .mockResolvedValueOnce({ data: 'aW1hZ2U=', mimeType: 'image/png' })
      .mockRejectedValueOnce(new Error('attachment removed after queue acceptance'));
    expect(
      (
        await h.client.sendPrompt({
          conversationId: h.conversationId,
          promptId: attachmentId,
          prompt: {
            text: 'queued attachment',
            attachments: [{ type: 'attachment', id: 'image', mimeType: 'image/png' }],
          },
        })
      ).success
    ).toBe(true);
    await h.send('last');
    running.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(() => expect(h.provider.agent.prompt).toHaveBeenCalledTimes(2));
    expect(h.provider.agent.prompt).toHaveBeenLastCalledWith(
      expect.objectContaining({ prompt: [{ type: 'text', text: 'last' }] })
    );
    const history = await h.history();
    expect(history.turns).toHaveLength(2);
    expect(history.turns[1]).toMatchObject({
      outcome: { kind: 'error', reason: 'prompt_failed' },
      items: [{ text: 'queued attachment', promptId: attachmentId }],
    });
    last.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(async () => expect((await h.history()).turns).toHaveLength(3));
  });

  it.each(['', ' ', '\n\t'])('does not create a phantom turn for empty input %j', async (text) => {
    h = await createHarness();
    expect((await h.send(text)).success).toBe(false);
    expect(h.provider.agent.prompt).not.toHaveBeenCalled();
    expect((await h.history()).turns).toEqual([]);
  });

  it('keeps hidden context out of the public transcript while preserving the visible request', async () => {
    h = await createHarness();
    const done = h.gate();
    expect(
      (
        await h.client.sendPrompt({
          conversationId: h.conversationId,
          promptId: randomUUID(),
          prompt: { text: 'visible request', hiddenContext: 'private orchestration instructions' },
        })
      ).success
    ).toBe(true);
    done.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(async () => expect((await h.history()).turns).toHaveLength(1));
    expect(messageTexts((await h.history()).turns[0])).toEqual(['visible request']);
    expect(h.provider.agent.prompt).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: [
          { type: 'text', text: 'visible request' },
          { type: 'text', text: 'private orchestration instructions' },
        ],
      })
    );
  });

  it('isolates histories and active prompts in two conversations on the same provider connection', async () => {
    h = await createHarness();
    h.provider.agent.newSession.mockResolvedValueOnce({ sessionId: 'session-other' });
    expect(
      (
        await h.client.startSession({
          ...makeStartInput({ conversationId: 'other' }),
          mode: 'resume',
        })
      ).success
    ).toBe(true);
    const first = h.gate();
    const second = h.gate();
    await h.send('main prompt');
    await h.client.sendPrompt({
      conversationId: 'other',
      promptId: randomUUID(),
      prompt: { text: 'other prompt' },
    });
    await h.update({
      sessionUpdate: 'agent_message_chunk',
      content: { type: 'text', text: 'main answer' },
    });
    await h.provider.client().sessionUpdate({
      sessionId: 'session-other',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'other answer' },
      },
    });
    second.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(async () =>
      expect(await h.client.loadHistory({ conversationId: 'other', limit: 100 })).toMatchObject({
        success: true,
        data: { turns: [{ items: [{ text: 'other prompt' }, { text: 'other answer' }] }] },
      })
    );
    expect((await h.history()).turns).toHaveLength(0);
    first.resolve({ stopReason: 'end_turn' });
    await vi.waitFor(async () =>
      expect((await h.history()).turns[0].items).toMatchObject([
        { text: 'main prompt' },
        { text: 'main answer' },
      ])
    );
  });
});
