import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { provider } from './index';
import { OPENCODE_PLUGIN_CONTENT } from './plugin-file';

function createMemoryFs(): PluginFs & { files: Map<string, string> } {
  const files = new Map<string, string>();

  return {
    files,
    async read(path) {
      return files.get(path) ?? null;
    },
    async write(path, content) {
      files.set(path, content);
    },
    async delete(path) {
      files.delete(path);
    },
    async exists(path) {
      return files.has(path);
    },
    async list(path) {
      return [...files.keys()].filter((file) => file.startsWith(path));
    },
  };
}

async function loadPlugin() {
  const source = Buffer.from(OPENCODE_PLUGIN_CONTENT).toString('base64');
  return import(`data:text/javascript;base64,${source}#${crypto.randomUUID()}`);
}

function hookTypes(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([, init]) => {
    const headers = new Headers((init as RequestInit).headers);
    return headers.get('X-Emdash-Event-Type') ?? '';
  });
}

describe('OpenCode plugin hooks', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('installs a plugin that supports the OpenCode v1 and v2 entry points', async () => {
    const fs = createMemoryFs();

    const written = await provider.behavior.plugins?.installPlugin(fs, { kind: 'global' });

    expect(written).toEqual(['plugins/emdash-notifications.js']);
    const content = await fs.read('plugins/emdash-notifications.js');
    expect(content).toContain('export const EmdashNotifications');
    expect(content).toContain("id: 'emdash-notifications'");
    expect(content).toContain('eventApi.subscribe({ signal })');
    expect(content).toContain("event.type === 'session.status'");
  });

  it('maps session.status busy/idle for custom OpenAI-compatible providers', async () => {
    vi.stubEnv('EMDASH_HOOK_PORT', '9876');
    vi.stubEnv('EMDASH_HOOK_NONCE', 'nonce');
    vi.stubEnv('EMDASH_PTY_ID', 'pty-status');
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    const plugin = await loadPlugin();
    const v1 = await plugin.EmdashNotifications();

    await v1.event({
      event: {
        type: 'session.status',
        properties: { sessionID: 'ses_unbar', status: { type: 'busy' } },
      },
    });
    await v1.event({
      event: {
        type: 'session.status',
        properties: {
          sessionID: 'ses_unbar',
          status: { type: 'retry', attempt: 1, message: 'rate', next: 2 },
        },
      },
    });
    await v1.event({
      event: {
        type: 'session.status',
        properties: { sessionID: 'ses_unbar', status: { type: 'idle' } },
      },
    });

    expect(hookTypes(fetchMock)).toEqual([
      'session',
      'start',
      'session',
      'start',
      'session',
      'stop',
    ]);
  });

  it('reports v1 idle events as stop so the sidebar spinner clears', async () => {
    vi.stubEnv('EMDASH_HOOK_PORT', '9876');
    vi.stubEnv('EMDASH_HOOK_NONCE', 'nonce');
    vi.stubEnv('EMDASH_PTY_ID', 'pty-1');
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    const plugin = await loadPlugin();
    const v1 = await plugin.EmdashNotifications();

    await v1.event({
      event: { type: 'session.idle', properties: { sessionID: 'ses_v1' } },
    });

    expect(hookTypes(fetchMock)).toEqual(['session', 'stop']);
  });

  it('reports v2 execution lifecycle events as start and stop hooks', async () => {
    vi.stubEnv('EMDASH_HOOK_PORT', '9876');
    vi.stubEnv('EMDASH_HOOK_NONCE', 'nonce');
    vi.stubEnv('EMDASH_PTY_ID', 'pty-2');
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    const plugin = await loadPlugin();
    const events = [
      { type: 'session.execution.started', data: { sessionID: 'ses_v2' } },
      { type: 'session.execution.succeeded', data: { sessionID: 'ses_v2' } },
    ];
    const cleanup = plugin.default.setup({
      event: {
        async *subscribe() {
          yield* events;
        },
      },
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));

    expect(hookTypes(fetchMock)).toEqual(['session', 'start', 'session', 'stop']);
    cleanup();
  });

  it('clears working status when a v2 execution is interrupted', async () => {
    vi.stubEnv('EMDASH_HOOK_PORT', '9876');
    vi.stubEnv('EMDASH_HOOK_NONCE', 'nonce');
    vi.stubEnv('EMDASH_PTY_ID', 'pty-3');
    const fetchMock = vi.fn().mockResolvedValue(new Response());
    vi.stubGlobal('fetch', fetchMock);
    const plugin = await loadPlugin();
    const cleanup = plugin.default.setup({
      event: {
        async *subscribe() {
          yield {
            type: 'session.execution.interrupted',
            data: { sessionID: 'ses_interrupted', reason: 'user' },
          };
        },
      },
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    expect(hookTypes(fetchMock)).toEqual(['session', 'stop']);
    cleanup();
  });

  it('declares start so Enter no longer owns the working spinner', () => {
    expect(provider.capabilities.hooks).toEqual({
      kind: 'plugin',
      scope: 'global',
      supportedEvents: ['notification', 'start', 'stop', 'session'],
    });
  });
});
