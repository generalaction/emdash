import { defaultHookEventParser } from '@emdash/core/services/agent-plugins/api/plugins/helpers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  callbacks,
  hookServer,
  installedExtension,
  type ExtensionApi,
  type HookRequest,
} from './hook-test-helpers';

const success = { messages: [{ role: 'assistant', stopReason: 'stop' }] };
const failure = {
  messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'provider unavailable' }],
};

function parsed(request: HookRequest) {
  const body = request.body;
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new Error('Invalid hook body');
  return defaultHookEventParser(String(request.headers['x-emdash-event-type']), { ...body });
}

describe('installed OmO extension execution', () => {
  let extension: Awaited<ReturnType<typeof installedExtension>>;
  let server: Awaited<ReturnType<typeof hookServer>>;
  let hook: ReturnType<typeof callbacks>;
  let load: (api: ExtensionApi) => void;

  beforeEach(async () => {
    server = await hookServer();
    vi.stubEnv('EMDASH_HOOK_PORT', server.port);
    vi.stubEnv('EMDASH_HOOK_NONCE', 'nonce-value');
    vi.stubEnv('EMDASH_HOOK_TOKEN', 'legacy-token');
    vi.stubEnv('EMDASH_PTY_ID', 'pty-value');
    extension = await installedExtension();
    const module: { default(api: ExtensionApi): void } = await import(
      /* @vite-ignore */ extension.moduleUrl
    );
    load = module.default;
    hook = callbacks(load);
  });

  afterEach(async () => {
    await hook.emit('session_shutdown');
    vi.restoreAllMocks();
    await server.dispose();
    await extension.dispose();
    vi.unstubAllEnvs();
  });

  it('installs idempotently without changing settings or other extensions', async () => {
    await extension.fs.write('settings.json', '{"other":true}');
    await extension.fs.write('extensions/other.js', 'export default () => {}');
    const written = await extension.plugins.installPlugin(extension.fs, { kind: 'global' });
    expect(written).toEqual(['extensions/emdash-hook.js']);
    expect(await extension.plugins.isPluginInstalled(extension.fs, { kind: 'global' })).toBe(true);
    expect(await extension.fs.read('settings.json')).toBe('{"other":true}');
    expect(await extension.fs.read('extensions/other.js')).toBe('export default () => {}');
  });

  it('delivers session files on startup, switch and agent start with real routing headers', async () => {
    const received = server.next();
    await hook.emit('session_start', { reason: 'startup' });
    await received;
    hook.setSessionFile('/sessions/switched.jsonl');
    await hook.emit('session_start', { reason: 'resume' });
    await hook.emit('agent_start');
    expect(server.requests.map(parsed)).toEqual([
      { kind: 'session', providerSessionId: '/sessions/first session.jsonl' },
      { kind: 'session', providerSessionId: '/sessions/switched.jsonl' },
      { kind: 'session', providerSessionId: '/sessions/switched.jsonl' },
      expect.objectContaining({ kind: 'status', type: 'start' }),
    ]);
    expect(server.requests[0]).toMatchObject({
      url: '/hook',
      headers: {
        'content-type': 'application/json',
        'x-emdash-token': 'nonce-value',
        'x-emdash-pty-id': 'pty-value',
        'x-emdash-event-type': 'session',
      },
      body: { providerSessionId: '/sessions/first session.jsonl' },
    });
  });

  it('waits for settlement and replaces a failed retry outcome with success', async () => {
    await hook.emit('agent_start');
    await hook.emit('agent_end', { ...failure, willRetry: true });
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
    ]);
    await hook.emit('agent_start');
    await hook.emit('agent_end', success);
    await hook.emit('agent_settled');
    await hook.emit('agent_settled');
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'stop' }),
    ]);
  });

  it.each([
    { end: { ...success, aborted: true }, settled: {}, type: 'notification' },
    {
      end: { ...failure, aborted: true, abortSource: 'user', willRetry: true } as const,
      settled: { fallbackExhausted: {} },
      type: 'notification',
    },
    {
      end: { messages: [{ role: 'assistant', stopReason: 'aborted' }] },
      settled: {},
      type: 'notification',
    },
    { end: failure, settled: {}, type: 'error' },
    { end: { ...failure, willRetry: true }, settled: {}, type: 'error' },
    { end: success, settled: { fallbackExhausted: {} }, type: 'error' },
    { end: { messages: [] }, settled: {}, type: 'error' },
  ])('settles $type without falsely completing', async ({ end, settled, type }) => {
    await hook.emit('agent_start');
    await hook.emit('agent_end', end);
    await hook.emit('agent_settled', settled);
    await hook.emit('session_shutdown', { reason: 'quit' });
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type }),
    ]);
  });

  it('reports an unknown settled outcome as error rather than success', async () => {
    await hook.emit('agent_start');
    await hook.emit('agent_settled');
    expect(server.requests.map(parsed)).toEqual([
      expect.objectContaining({ kind: 'session' }),
      expect.objectContaining({ kind: 'status', type: 'start' }),
      expect.objectContaining({ kind: 'status', type: 'error' }),
    ]);
  });

  it('cancels retry backoff and prevents a late settled event from completing', async () => {
    await hook.emit('agent_start');
    await hook.emit('agent_end', { ...failure, willRetry: true });
    await hook.emit('session_abort');
    await hook.emit('agent_settled', { fallbackExhausted: {} });
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'notification', notificationType: undefined }),
    ]);
  });

  it('restores working only after the final nested blocking UI prompt ends', async () => {
    await hook.emit('agent_start');
    await hook.emit('ui_prompt_start');
    await hook.emit('ui_prompt_start');
    await hook.emit('ui_prompt_end');
    await hook.emit('ui_prompt_end');
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'notification', notificationType: 'elicitation_dialog' }),
      expect.objectContaining({ type: 'notification', notificationType: 'elicitation_dialog' }),
      expect.objectContaining({ type: 'notification', notificationType: 'elicitation_dialog' }),
      expect.objectContaining({ type: 'start' }),
    ]);
  });

  it.each(['session_abort', 'agent_settled'])(
    'does not restore working after %s occurs during a UI prompt',
    async (terminal) => {
      await hook.emit('agent_start');
      await hook.emit('ui_prompt_start');
      await hook.emit('agent_end', success);
      await hook.emit(terminal);
      await hook.emit('ui_prompt_end');
      expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
        expect.objectContaining({ type: 'start' }),
        expect.objectContaining({ type: 'notification', notificationType: 'elicitation_dialog' }),
        expect.objectContaining({ type: terminal === 'session_abort' ? 'notification' : 'stop' }),
      ]);
    }
  );

  it('restores idle for a UI prompt outside an agent run without another completion', async () => {
    await hook.emit('agent_start');
    await hook.emit('agent_end', success);
    await hook.emit('agent_settled');
    await hook.emit('ui_prompt_start');
    await hook.emit('ui_prompt_end');
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'stop' }),
      expect.objectContaining({ type: 'notification', notificationType: 'elicitation_dialog' }),
      expect.objectContaining({ type: 'notification', notificationType: undefined }),
    ]);
  });

  it('preserves delivery order across overlapping callbacks and consecutive turns', async () => {
    const received = server.next();
    await Promise.all([
      hook.emit('agent_start'),
      hook.emit('agent_end', success),
      hook.emit('agent_settled'),
      hook.emit('agent_start'),
      hook.emit('agent_end', success),
      hook.emit('agent_settled'),
    ]);
    await received;
    expect(server.requests.map(parsed).filter((event) => event.kind === 'status')).toEqual([
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'stop' }),
      expect.objectContaining({ type: 'start' }),
      expect.objectContaining({ type: 'stop' }),
    ]);
  });

  it('retires old callbacks on reload without registering global process listeners', async () => {
    const before = [
      process.listenerCount('uncaughtException'),
      process.listenerCount('unhandledRejection'),
    ];
    await hook.emit('session_shutdown', { reason: 'reload' });
    await hook.emit('agent_start');
    hook = callbacks(load);
    await hook.emit('session_start', { reason: 'reload' });
    expect(server.requests.map(parsed)).toEqual([
      { kind: 'session', providerSessionId: '/sessions/first session.jsonl' },
    ]);
    expect([
      process.listenerCount('uncaughtException'),
      process.listenerCount('unhandledRejection'),
    ]).toEqual(before);
    expect(hook.handlers.has('agent_before_settle')).toBe(false);
  });

  it('does not emit undefined session identifiers', async () => {
    hook.setSessionFile(undefined);
    await hook.emit('session_start');
    await hook.emit('agent_start');
    expect(server.requests.map(parsed)).toEqual([
      expect.objectContaining({ kind: 'status', type: 'start' }),
    ]);
  });
});
