import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callbacks, hookServer, installedExtension, type ExtensionApi } from './hook-test-helpers';

describe('OmO hook transport failure boundaries', () => {
  let extension: Awaited<ReturnType<typeof installedExtension>>;
  let server: Awaited<ReturnType<typeof hookServer>>;
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
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await server.dispose();
    await extension.dispose();
    vi.unstubAllEnvs();
  });

  it.each(['EMDASH_HOOK_PORT', 'EMDASH_HOOK_NONCE', 'EMDASH_PTY_ID'])(
    'does not send requests without routing variable %s',
    async (key) => {
      vi.stubEnv(key, '');
      if (key === 'EMDASH_HOOK_NONCE') vi.stubEnv('EMDASH_HOOK_TOKEN', '');
      const fetchSpy = vi.spyOn(globalThis, 'fetch');
      const outside = callbacks(load);
      await outside.emit('agent_start');
      await outside.emit('agent_end', { messages: [{ role: 'assistant', stopReason: 'stop' }] });
      await outside.emit('agent_settled');
      expect(fetchSpy).not.toHaveBeenCalled();
    }
  );

  it('uses the legacy token when the nonce is absent', async () => {
    vi.stubEnv('EMDASH_HOOK_NONCE', '');
    const legacy = callbacks(load);
    await legacy.emit('session_start');
    expect(server.requests[0]?.headers['x-emdash-token']).toBe('legacy-token');
  });

  it('tolerates a closed hook server without retries', async () => {
    const hook = callbacks(load);
    await server.dispose();
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await hook.emit('session_start');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    // Keep teardown ownership uniform after exercising the refused connection.
    server = await hookServer();
  });

  it('aborts a stalled localhost delivery with a two-second timeout signal', async () => {
    await server.dispose();
    server = await hookServer({ holdResponse: true });
    vi.stubEnv('EMDASH_HOOK_PORT', server.port);
    const stalled = callbacks(load);
    const received = server.next();
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    const sending = stalled.emit('session_start');
    await received;
    controller.abort();
    await sending;
    expect(timeout).toHaveBeenCalledWith(2000);
    expect(server.requests).toEqual([
      expect.objectContaining({ body: { providerSessionId: '/sessions/first session.jsonl' } }),
    ]);
  });
});
