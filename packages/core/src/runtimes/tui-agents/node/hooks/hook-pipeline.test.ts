import type { Logger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedTuiProvider } from '#services/agent-plugins/api/plugins';
import { TuiHookPipeline } from './hook-pipeline';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function createPipeline(validateSessionId?: (id: string) => boolean) {
  const applyCanonicalEvent = vi.fn();
  const provider = {
    parseHookEvent: (type: string, body: Record<string, unknown>) =>
      type === 'stop'
        ? {
            kind: 'status' as const,
            type: 'stop' as const,
            providerSessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
          }
        : { kind: 'ignore' as const },
    validateSessionId,
  } as unknown as ResolvedTuiProvider;
  const pipeline = new TuiHookPipeline({
    getConversationConfig: () => ({ conversationId: 'conv-1', providerId: 'p' }),
    getProvider: () => provider,
    applyCanonicalEvent,
    logger,
  });
  return { pipeline, applyCanonicalEvent };
}

describe('TuiHookPipeline', () => {
  it('keeps a valid session id carried on a status event', async () => {
    const { pipeline, applyCanonicalEvent } = createPipeline((id) => id.startsWith('ok-'));

    await pipeline.handle({ ptyId: 'conv-1', type: 'stop', body: '{"session_id":"ok-1"}' });

    expect(applyCanonicalEvent).toHaveBeenCalledWith('conv-1', 'p', {
      kind: 'status',
      type: 'stop',
      providerSessionId: 'ok-1',
    });
  });

  it('strips an invalid session id from a status event but still applies the status', async () => {
    const { pipeline, applyCanonicalEvent } = createPipeline((id) => id.startsWith('ok-'));

    await pipeline.handle({ ptyId: 'conv-1', type: 'stop', body: '{"session_id":"bad-1"}' });

    expect(applyCanonicalEvent).toHaveBeenCalledTimes(1);
    const event = applyCanonicalEvent.mock.calls[0]![2];
    expect(event).toMatchObject({ kind: 'status', type: 'stop' });
    expect(event.providerSessionId).toBeUndefined();
  });
});
