import { isOk } from '@emdash/shared';
import { describe, expect, it } from 'vitest';
import { makeAcpHarness, makeStartInput } from '../acp-test-support';
import { sessionConfigStateSchema, sessionUsageSchema } from '../models/config';
import { promptDraftSchema } from '../models/prompt';
import { sessionStateSchema } from '../models/session';
import { transcriptTurnSchema } from '../models/turns';
import { AcpRuntime } from '../runtime/runtime';
import { uploadAttachmentCommandSchema } from './commands';

describe('ACP API contract schemas', () => {
  it('parses runtime live model snapshots with the public schemas', async () => {
    const h = makeAcpHarness();
    const rt = new AcpRuntime(h.deps);
    const started = await rt.startSession(makeStartInput({ conversationId: 'conv-contract' }));
    expect(isOk(started)).toBe(true);

    const live = rt.sessionLiveModels('conv-contract');
    if (!live) throw new Error('expected live models');

    expect(() => sessionStateSchema.parse(live.sessionState.snapshot().data)).not.toThrow();
    expect(() => sessionConfigStateSchema.parse(live.config.snapshot().data)).not.toThrow();
    expect(() => sessionUsageSchema.nullable().parse(live.usage.snapshot().data)).not.toThrow();
    expect(() =>
      transcriptTurnSchema.nullable().parse(live.activeTurn.snapshot().data)
    ).not.toThrow();
    expect(() => promptDraftSchema.nullable().parse(live.draft.snapshot().data)).not.toThrow();
  });

  it('accepts attachment uploads by bytes or original path', () => {
    expect(() =>
      uploadAttachmentCommandSchema.parse({
        data: new Uint8Array([1, 2, 3]),
        mimeType: 'image/png',
        name: 'image.png',
      })
    ).not.toThrow();
    expect(() =>
      uploadAttachmentCommandSchema.parse({
        originalPath: '/tmp/image.png',
        mimeType: 'image/png',
        name: 'image.png',
      })
    ).not.toThrow();
    expect(() =>
      uploadAttachmentCommandSchema.parse({
        mimeType: 'image/png',
        name: 'image.png',
      })
    ).toThrow();
  });
});
