import type { Logger } from '@emdash/shared/logger';
import { describe, expect, it, vi } from 'vitest';
import type { ResolvedTuiProvider } from '#services/agent-plugins/api/plugins';
import { TuiHookPipeline } from './hook-pipeline';
import { TuiHookServer } from './hook-server';

const logger = {
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger;

function createPipeline(
  validateSessionId?: (id: string) => boolean,
  applyTaskName?: (conversationId: string, name: string) => void
) {
  const applyCanonicalEvent = vi.fn();
  const parseHookEvent = vi.fn((type: string, body: Record<string, unknown>) =>
    type === 'stop'
      ? {
          kind: 'status' as const,
          type: 'stop' as const,
          providerSessionId: typeof body.session_id === 'string' ? body.session_id : undefined,
        }
      : { kind: 'ignore' as const }
  );
  const provider = {
    parseHookEvent,
    validateSessionId,
  } as unknown as ResolvedTuiProvider;
  const pipeline = new TuiHookPipeline({
    getConversationConfig: (id) =>
      id === 'conv-1' ? { conversationId: 'conv-1', providerId: 'p' } : null,
    getProvider: () => provider,
    applyCanonicalEvent,
    applyTaskName,
    logger,
  });
  return { pipeline, applyCanonicalEvent, parseHookEvent };
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

  it.each(['Fix login', 'one-two three-four five', 'x'.repeat(256)])(
    'routes a valid task name before provider parsing: %s',
    async (name) => {
      const applyTaskName = vi.fn();
      const { pipeline, applyCanonicalEvent, parseHookEvent } = createPipeline(
        undefined,
        applyTaskName
      );

      await pipeline.handle({
        ptyId: 'conv-1',
        type: 'task-name',
        body: JSON.stringify({ name }),
      });

      expect(applyTaskName).toHaveBeenCalledWith('conv-1', name);
      expect(parseHookEvent).not.toHaveBeenCalled();
      expect(applyCanonicalEvent).not.toHaveBeenCalled();
    }
  );

  it.each([
    '',
    '{"name":"secret-body-marker"',
    '{}',
    'null',
    '[]',
    '{"name":42}',
    '{"name":""}',
    '{"name":"  \\t\\n"}',
    JSON.stringify({ name: 'x'.repeat(257) }),
    JSON.stringify({ name: 'one two three four five six' }),
    JSON.stringify({ name: 'one-two-three-four-five-six' }),
    JSON.stringify({ name: 'one-two three-four five-six' }),
  ])('rejects an invalid task-name payload without disclosing it: %s', async (body) => {
    const applyTaskName = vi.fn();
    const { pipeline, applyCanonicalEvent, parseHookEvent } = createPipeline(
      undefined,
      applyTaskName
    );

    await expect(pipeline.handle({ ptyId: 'conv-1', type: 'task-name', body })).rejects.toEqual(
      new Error('Invalid task-name payload')
    );

    expect(applyTaskName).not.toHaveBeenCalled();
    expect(parseHookEvent).not.toHaveBeenCalled();
    expect(applyCanonicalEvent).not.toHaveBeenCalled();
  });

  it('ignores naming feedback when the optional callback is absent', async () => {
    const { pipeline, applyCanonicalEvent, parseHookEvent } = createPipeline();

    await expect(
      pipeline.handle({ ptyId: 'conv-1', type: 'task-name', body: '{"name":"Fix login"}' })
    ).resolves.toBeUndefined();

    expect(parseHookEvent).not.toHaveBeenCalled();
    expect(applyCanonicalEvent).not.toHaveBeenCalled();
  });

  it('does not name an unrecognized conversation', async () => {
    const applyTaskName = vi.fn();
    const { pipeline } = createPipeline(undefined, applyTaskName);

    await pipeline.handle({
      ptyId: 'unknown',
      type: 'task-name',
      body: '{"name":"Fix login"}',
    });

    expect(applyTaskName).not.toHaveBeenCalled();
  });

  it('requires authentication on the HTTP task-name route', async () => {
    const applyTaskName = vi.fn();
    const { pipeline, applyCanonicalEvent, parseHookEvent } = createPipeline(
      undefined,
      applyTaskName
    );
    const server = new TuiHookServer((raw) => pipeline.handle(raw), logger);
    try {
      const { port, token } = await server.ensureStarted();
      const request = (authToken: string) =>
        fetch(`http://127.0.0.1:${port}/hook`, {
          method: 'POST',
          signal: AbortSignal.timeout(5_000),
          headers: {
            'Content-Type': 'application/json',
            'x-emdash-token': authToken,
            'x-emdash-pty-id': 'conv-1',
            'x-emdash-event-type': 'task-name',
          },
          body: '{"name":"  Fix login  "}',
        });

      expect((await request('invalid-token')).status).toBe(403);
      expect(applyTaskName).not.toHaveBeenCalled();
      expect((await request(token)).status).toBe(200);
      expect(applyTaskName).toHaveBeenCalledExactlyOnceWith('conv-1', 'Fix login');
      expect(parseHookEvent).not.toHaveBeenCalled();
      expect(applyCanonicalEvent).not.toHaveBeenCalled();
    } finally {
      server.stop();
    }
  });

  it('returns an HTTP error for invalid JSON without logging the body or token', async () => {
    const applyTaskName = vi.fn();
    const { pipeline } = createPipeline(undefined, applyTaskName);
    const warn = vi.fn();
    const server = new TuiHookServer((raw) => pipeline.handle(raw), { ...logger, warn });
    try {
      const { port, token } = await server.ensureStarted();
      const body = `{"name":"secret-body-marker ${token}"`;
      const response = await fetch(`http://127.0.0.1:${port}/hook`, {
        method: 'POST',
        signal: AbortSignal.timeout(5_000),
        headers: {
          'x-emdash-token': token,
          'x-emdash-pty-id': 'conv-1',
          'x-emdash-event-type': 'task-name',
        },
        body,
      });

      expect(response.status).toBe(500);
      expect(applyTaskName).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith('TuiHookServer: handler error', {
        error: 'Error: Invalid task-name payload',
      });
      expect(JSON.stringify(warn.mock.calls)).not.toContain('secret-body-marker');
      expect(JSON.stringify(warn.mock.calls)).not.toContain(token);
    } finally {
      server.stop();
    }
  });
});
