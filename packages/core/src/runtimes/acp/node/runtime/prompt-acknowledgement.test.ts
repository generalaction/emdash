import { randomUUID } from 'node:crypto';
import { ok } from '@emdash/shared';
import { deferred } from '@emdash/shared/testing';
import { describe, expect, it, vi } from 'vitest';
import { makeAcpHarness, makeStartInput } from '../acp-test-support';
import { AcpRuntime } from './runtime';

describe('prompt acceptance', () => {
  it('waits for attachment validation before acknowledging or starting execution', async () => {
    const attachment = deferred<{ data: string; mimeType: string }>();
    const resolveAttachment = vi.fn().mockReturnValue(attachment.promise);
    const h = makeAcpHarness({ resolveAttachment });
    const runtime = new AcpRuntime(h.deps);
    try {
      await runtime.launchSession(makeStartInput());
      let settled = false;
      const submission = runtime
        .sendPrompt('conv-1', {
          text: 'hello',
          attachments: [{ type: 'attachment', id: 'image', mimeType: 'image/png' }],
        })
        .then((result) => {
          settled = true;
          return result;
        });
      await vi.waitFor(() => expect(resolveAttachment).toHaveBeenCalledOnce());
      expect(settled).toBe(false);
      expect(h.agent.prompt).not.toHaveBeenCalled();
      attachment.resolve({ data: '', mimeType: 'image/png' });
      await expect(submission).resolves.toEqual(ok({ queued: false }));
      expect(resolveAttachment).toHaveBeenCalledOnce();
    } finally {
      attachment.resolve({ data: '', mimeType: 'image/png' });
      await runtime.dispose();
    }
  });

  it('rejects invalid attachments while working without adding a queued prompt', async () => {
    const turn = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness({
      resolveAttachment: vi.fn().mockRejectedValue(new Error('missing')),
    });
    h.agent.prompt.mockReturnValueOnce(turn.promise);
    const runtime = new AcpRuntime(h.deps);
    try {
      await runtime.launchSession(makeStartInput());
      await runtime.sendPrompt('conv-1', { text: 'first' });
      await expect(
        runtime.sendPrompt(
          'conv-1',
          {
            text: 'next',
            attachments: [{ type: 'attachment', id: 'missing', mimeType: 'image/png' }],
          },
          'queue'
        )
      ).resolves.toMatchObject({ success: false, error: { type: 'prompt_failed' } });
      expect(runtime.getSessionState('conv-1').queuedPrompts).toEqual([]);
      expect(h.agent.prompt).toHaveBeenCalledOnce();
    } finally {
      turn.resolve({ stopReason: 'end_turn' });
      await runtime.dispose();
    }
  });

  it('holds the execution lease after acknowledging until the turn settles', async () => {
    const turn = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness();
    h.agent.prompt.mockReturnValueOnce(turn.promise);
    const runtime = new AcpRuntime(h.deps);
    try {
      await runtime.attachSession(makeStartInput());
      await runtime.manager.sendPrompt({
        conversationId: 'conv-1',
        promptId: randomUUID(),
        prompt: { text: 'hello' },
      });
      let stopped = false;
      const stop = runtime.stopSession('conv-1').then(() => {
        stopped = true;
      });
      await vi.waitFor(() => expect(h.agent.closeSession).toHaveBeenCalledOnce());
      expect(stopped).toBe(false);
      turn.resolve({ stopReason: 'end_turn' });
      await stop;
      expect(stopped).toBe(true);
    } finally {
      turn.resolve({ stopReason: 'end_turn' });
      await runtime.dispose();
    }
  });

  it('rejects empty prompts without starting a turn', async () => {
    const h = makeAcpHarness();
    const runtime = new AcpRuntime(h.deps);
    try {
      await runtime.attachSession(makeStartInput());
      await expect(
        runtime.manager.sendPrompt({
          conversationId: 'conv-1',
          promptId: randomUUID(),
          prompt: { text: '  ' },
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'invalid_state' } });
      expect(h.agent.prompt).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });
  it('awaits activation but acknowledges before provider completion', async () => {
    const activation = deferred<{ sessionId: string }>();
    const turn = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness();
    h.agent.newSession.mockReturnValueOnce(activation.promise);
    h.agent.prompt.mockReturnValueOnce(turn.promise);
    const runtime = new AcpRuntime(h.deps);
    await runtime.attachSession(makeStartInput());
    let accepted = false;
    const submission = runtime.manager
      .sendPrompt({ conversationId: 'conv-1', promptId: randomUUID(), prompt: { text: 'hello' } })
      .then((result) => {
        accepted = true;
        return result;
      });
    try {
      await vi.waitFor(() => expect(h.agent.newSession).toHaveBeenCalledOnce());
      expect(accepted).toBe(false);
      expect(h.agent.prompt).not.toHaveBeenCalled();
      activation.resolve({ sessionId: 'session-1' });
      await expect(submission).resolves.toEqual(ok({ queued: false }));
      expect(h.agent.prompt).toHaveBeenCalledOnce();
      expect(runtime.getSessionState('conv-1').isGenerating).toBe(true);
      turn.resolve({ stopReason: 'end_turn' });
      await vi.waitFor(() => expect(runtime.getSessionState('conv-1').isGenerating).toBe(false));
    } finally {
      activation.resolve({ sessionId: 'session-1' });
      turn.resolve({ stopReason: 'end_turn' });
      await runtime.dispose();
    }
  });

  it('returns authentication failure before accepting a prompt', async () => {
    const h = makeAcpHarness();
    h.agent.newSession.mockRejectedValueOnce({ code: -32000, message: 'Authentication required' });
    const runtime = new AcpRuntime(h.deps);
    try {
      await runtime.attachSession(makeStartInput());
      await expect(
        runtime.manager.sendPrompt({
          conversationId: 'conv-1',
          promptId: randomUUID(),
          prompt: { text: 'hello' },
        })
      ).resolves.toMatchObject({ success: false, error: { type: 'auth_required' } });
      expect(h.agent.prompt).not.toHaveBeenCalled();
    } finally {
      await runtime.dispose();
    }
  });

  it.each(['auto', 'queue'] as const)(
    'rejects invalid attachments before accepting %s placement',
    async (placement) => {
      const h = makeAcpHarness({
        resolveAttachment: vi.fn().mockRejectedValue(new Error('missing attachment')),
      });
      const runtime = new AcpRuntime(h.deps);
      try {
        await runtime.launchSession(makeStartInput());
        await expect(
          runtime.manager.sendPrompt({
            conversationId: 'conv-1',
            promptId: randomUUID(),
            placement,
            prompt: {
              text: 'hello',
              attachments: [{ type: 'attachment', id: 'missing', mimeType: 'image/png' }],
            },
          })
        ).resolves.toMatchObject({ success: false, error: { type: 'prompt_failed' } });
        expect(runtime.getSessionState('conv-1').queuedPrompts).toEqual([]);
        expect(runtime.getSessionState('conv-1').isGenerating).toBe(false);
        expect(h.agent.prompt).not.toHaveBeenCalled();
      } finally {
        await runtime.dispose();
      }
    }
  );

  it.each(['auto', 'queue'] as const)(
    'acknowledges a queued prompt exactly once with %s placement',
    async (placement) => {
      const turn = deferred<{ stopReason: 'end_turn' }>();
      const h = makeAcpHarness();
      h.agent.prompt.mockReturnValueOnce(turn.promise);
      const runtime = new AcpRuntime(h.deps);
      try {
        await runtime.launchSession(makeStartInput());
        await runtime.manager.sendPrompt({
          conversationId: 'conv-1',
          promptId: randomUUID(),
          prompt: { text: 'first' },
        });
        const promptId = randomUUID();
        await expect(
          runtime.manager.sendPrompt({
            conversationId: 'conv-1',
            promptId,
            placement,
            prompt: { text: 'next' },
          })
        ).resolves.toEqual(ok({ queued: true }));
        expect(runtime.getSessionState('conv-1').queuedPrompts).toMatchObject([
          { id: promptId, text: 'next' },
        ]);
        expect(h.agent.prompt).toHaveBeenCalledOnce();
        turn.resolve({ stopReason: 'end_turn' });
        await vi.waitFor(() => expect(h.agent.prompt).toHaveBeenCalledTimes(2));
      } finally {
        turn.resolve({ stopReason: 'end_turn' });
        await runtime.dispose();
      }
    }
  );

  it('reports provider failure in live state after successful acceptance', async () => {
    const turn = deferred<{ stopReason: 'end_turn' }>();
    const h = makeAcpHarness();
    h.agent.prompt.mockReturnValueOnce(turn.promise);
    const runtime = new AcpRuntime(h.deps);
    try {
      await runtime.launchSession(makeStartInput());
      await expect(
        runtime.manager.sendPrompt({
          conversationId: 'conv-1',
          promptId: randomUUID(),
          prompt: { text: 'hello' },
        })
      ).resolves.toEqual(ok({ queued: false }));
      turn.reject(new Error('provider failed'));
      await vi.waitFor(() => expect(runtime.getSessionState('conv-1').lastTurnErrored).toBe(true));
    } finally {
      turn.resolve({ stopReason: 'end_turn' });
      await runtime.dispose();
    }
  });
});
