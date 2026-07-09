import { isOk } from '@emdash/shared';
import { client, connect, memoryTransportPair, ReplicaState, serve } from '@emdash/wire';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { makeAcpHarness, makeStartInput } from '../acp-test-support';
import { sessionConfigStateSchema, sessionUsageSchema } from '../models/config';
import { promptDraftSchema } from '../models/prompt';
import { sessionStateSchema, sessionSummarySchema } from '../models/session';
import { transcriptTurnSchema } from '../models/turns';
import { AcpRuntime } from '../runtime/runtime';
import { uploadAttachmentCommandSchema } from './commands';
import { acpApiContract } from './contract';
import { createAcpController } from './controller';
import { acpRuntimeErrorSchema } from './errors';

describe('ACP API contract schemas', () => {
  it('parses runtime live model snapshots with the public schemas', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const started = await rt.startSession(makeStartInput({ conversationId: 'conv-contract' }));
    expect(isOk(started)).toBe(true);

    const live = rt.sessionLiveModels('conv-contract');
    if (!live) throw new Error('expected live models');

    expect(acpApiContract.session.id).toBe('session');
    expect(() => sessionStateSchema.parse(live.states.state.snapshot().data)).not.toThrow();
    expect(() => sessionConfigStateSchema.parse(live.states.config.snapshot().data)).not.toThrow();
    expect(() =>
      sessionUsageSchema.nullable().parse(live.states.usage.snapshot().data)
    ).not.toThrow();
    expect(() =>
      transcriptTurnSchema.nullable().parse(live.states.activeTurn.snapshot().data)
    ).not.toThrow();
    expect(() =>
      promptDraftSchema.nullable().parse(live.states.draft.snapshot().data)
    ).not.toThrow();
  });

  it('round-trips procedures and live state over a wire transport', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const pair = memoryTransportPair();
    const dispose = serve(pair.right, createAcpController(rt));
    const contractClient = client(acpApiContract, connect(pair.left));
    const summaries = new ReplicaState(contractClient.sessions.state(undefined, 'list'), {
      schema: z.record(z.string(), sessionSummarySchema),
    });

    try {
      await summaries.ready;
      const input = makeStartInput({ conversationId: 'conv-wire' });
      const started = await contractClient.startSession({ input });
      expect(started).toEqual({ success: true, data: { sessionId: 'session-1' } });

      await vi.waitFor(() => {
        expect(summaries.current()['conv-wire']).toMatchObject({
          conversationId: 'conv-wire',
          lifecycle: 'ready',
        });
      });

      const state = new ReplicaState(
        contractClient.session.state({ conversationId: 'conv-wire' }, 'state'),
        { schema: sessionStateSchema }
      );
      await state.ready;
      expect(state.current()).toMatchObject({ lifecycle: 'ready' });
      await state.dispose();
    } finally {
      await summaries.dispose();
      dispose();
      pair.left.close?.();
      pair.right.close?.();
    }
  });

  it('accepts attachment upload sidecar input with or without original path', () => {
    expect(() => uploadAttachmentCommandSchema.parse({})).not.toThrow();
    expect(() =>
      uploadAttachmentCommandSchema.parse({
        originalPath: '/tmp/image.png',
      })
    ).not.toThrow();
  });

  it('accepts auth_required runtime errors', () => {
    expect(() =>
      acpRuntimeErrorSchema.parse({
        type: 'auth_required',
        cause: { name: 'RequestError', message: 'Authentication required' },
      })
    ).not.toThrow();
  });
});
