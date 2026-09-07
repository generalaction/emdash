import { randomUUID } from 'node:crypto';
import { deferred } from '@emdash/shared/testing';
import {
  client,
  connect,
  createController,
  createWireSessionHub,
  defineContract,
  memoryTransportPair,
} from '@emdash/wire/rpc';
import { describe, expect, it, vi } from 'vitest';
import { acpApiContract } from '../../api';
import { makeAcpHarness, makeStartInput } from '../acp-test-support';
import { AcpRuntime } from './runtime';

describe('prompt acknowledgement over Wire', () => {
  it.each([false, true])(
    'keeps accepted execution alive after disconnect with lost acknowledgement: %s',
    async (loseReply) => {
      const turn = deferred<{ stopReason: 'end_turn' }>();
      const acknowledged = deferred<void>();
      const releaseReply = deferred<void>();
      const h = makeAcpHarness();
      h.agent.prompt.mockReturnValueOnce(turn.promise);
      const runtime = new AcpRuntime(h.deps);
      await runtime.attachSession(makeStartInput());
      const contract = defineContract({ sendPrompt: acpApiContract.sendPrompt });
      const hub = createWireSessionHub(
        createController(contract, {
          sendPrompt: async (input) => {
            const result = await runtime.sendPrompt(
              input.conversationId,
              input.prompt,
              input.placement,
              input.promptId
            );
            acknowledged.resolve();
            if (loseReply) await releaseReply.promise;
            return result;
          },
        })
      );
      const pair = memoryTransportPair();
      hub.open('desktop', pair.right);
      const connection = connect(pair.left);
      const promptId = randomUUID();
      const request = client(contract, connection).sendPrompt({
        conversationId: 'conv-1',
        promptId,
        prompt: { text: 'continue' },
      });
      const response = request.catch((error: unknown) => error);
      try {
        await acknowledged.promise;
        if (!loseReply)
          await expect(response).resolves.toEqual({ success: true, data: { queued: false } });
        pair.disconnect();
        if (loseReply) await expect(response).resolves.toMatchObject({ code: 'DISCONNECTED' });
        expect(runtime.getSessionState('conv-1').isGenerating).toBe(true);
        expect(h.agent.prompt).toHaveBeenCalledOnce();
        expect(h.agent.cancel).not.toHaveBeenCalled();
        turn.resolve({ stopReason: 'end_turn' });
        await vi.waitFor(() => expect(runtime.getSessionState('conv-1').isGenerating).toBe(false));
        expect(runtime.manager.getHistory('conv-1').turns[0].items[0]).toMatchObject({
          text: 'continue',
          promptId,
        });
      } finally {
        releaseReply.resolve();
        turn.resolve({ stopReason: 'end_turn' });
        connection.dispose();
        await hub.dispose();
        await runtime.dispose();
      }
    }
  );
});
