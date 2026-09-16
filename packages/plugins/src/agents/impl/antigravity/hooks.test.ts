import { Buffer } from 'node:buffer';
import { exec } from 'node:child_process';
import { createServer } from 'node:http';
import { promisify } from 'node:util';
import type { PluginFs } from '@emdash/core/services/agent-plugins/api/plugins';
import { describe, expect, it } from 'vitest';
import { buildAntigravityHookConfig } from './hooks';
import { provider } from './index';

const manifestPath = 'plugins/emdash/plugin.json';
const hooksPath = 'plugins/emdash/hooks.json';

function createFs(initial: Record<string, unknown> = {}) {
  const files = new Map(
    Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)])
  );
  const fs: PluginFs = {
    read: async (key) => files.get(key) ?? null,
    write: async (key, value) => {
      files.set(key, value);
    },
    delete: async (key) => {
      files.delete(key);
    },
    exists: async (key) => files.has(key),
    list: async () => [],
  };
  const read = (key: string) => JSON.parse(files.get(key)!);
  return { fs, files, read };
}

const hooks = buildAntigravityHookConfig();

describe('Antigravity hooks', () => {
  it('registers global lifecycle hooks at the shared customization root', () => {
    expect(provider.capabilities.hooks).toEqual({
      kind: 'config',
      scope: 'global',
      supportedEvents: ['session', 'start', 'stop'],
    });
    expect(hooks.resolveConfigRoots({ homeDir: '/home/user', env: {}, platform: 'linux' })).toEqual(
      ['/home/user/.gemini/config']
    );
  });

  it('installs the native named definition and manifest idempotently', async () => {
    const { fs, files, read } = createFs();
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    expect(await hooks.writeHooks(fs)).toEqual([manifestPath, hooksPath]);
    expect(read(manifestPath).name).toBe('emdash');
    expect(read(hooksPath)).toMatchObject({
      emdash: { enabled: true, PreInvocation: [{ type: 'command' }], Stop: [{ type: 'command' }] },
    });
    expect(await hooks.getHooksInstalled(fs)).toBe(true);
    const before = new Map(files);
    await hooks.writeHooks(fs);
    expect(files).toEqual(before);
    files.delete(manifestPath);
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    await hooks.writeHooks(fs);
    const config = read(hooksPath);
    config.emdash.Stop = [];
    files.set(hooksPath, JSON.stringify(config));
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
    await hooks.writeHooks(fs);
    expect(await hooks.getHooksInstalled(fs)).toBe(true);
  });

  it('installs Windows commands without a POSIX wrapper', async () => {
    const { fs, read } = createFs();
    await buildAntigravityHookConfig({ platform: 'win32' }).writeHooks(fs);
    for (const [event, expected] of [
      ['PreInvocation', '{}'],
      ['Stop', '{"decision":"stop"}'],
    ]) {
      const command = read(hooksPath).emdash[event][0].command;
      expect(command).toMatch(/^cmd\.exe .* -EncodedCommand [A-Za-z0-9+/]+=*$/);
      expect(command).not.toContain('/dev/null');
      expect(command).not.toContain('printf');
      const script = Buffer.from(command.split(' -EncodedCommand ')[1], 'base64').toString(
        'utf16le'
      );
      expect(script).toContain(`finally { [Console]::Out.WriteLine('${expected}') }`);
    }
  });

  it('preserves user definitions and handlers on installation and removal', async () => {
    const userHook = { type: 'command', command: 'echo user' };
    const { fs, read } = createFs({
      [manifestPath]: { name: 'emdash', description: 'custom' },
      [hooksPath]: {
        user: { Stop: [userHook] },
        emdash: { Stop: [userHook], PostInvocation: [userHook] },
      },
    });
    await hooks.writeHooks(fs);
    expect(read(hooksPath).emdash.Stop).toHaveLength(2);
    await hooks.deleteHooks(fs);
    expect(read(hooksPath)).toEqual({
      user: { Stop: [userHook] },
      emdash: { enabled: true, PreInvocation: [], Stop: [userHook], PostInvocation: [userHook] },
    });
    expect(read(manifestPath).description).toBe('custom');
    expect(await hooks.getHooksInstalled(fs)).toBe(false);
  });

  it.each([
    { [manifestPath]: { name: 'another-plugin' } },
    { [hooksPath]: { emdash: 'invalid' } },
    { [hooksPath]: { emdash: { Stop: {} } } },
  ])('rejects incompatible configuration without writing: %j', async (initial) => {
    const { fs, files } = createFs(initial);
    const before = new Map(files);
    await expect(hooks.writeHooks(fs)).rejects.toThrow();
    expect(files).toEqual(before);
  });

  it('leaves malformed JSON untouched', async () => {
    const { fs, files } = createFs();
    files.set(hooksPath, '{broken');
    const before = new Map(files);
    await expect(hooks.writeHooks(fs)).rejects.toThrow();
    expect(files).toEqual(before);
  });

  it('maps successive invocations and idle stops without requiring turn IDs', () => {
    for (const invocationNum of [0, 1, 2]) {
      expect(hooks.parseHookEvent('start', { conversationId: 'session', invocationNum })).toEqual({
        kind: 'status',
        type: 'start',
        providerSessionId: 'session',
      });
      expect(
        hooks.parseHookEvent('stop', {
          conversationId: 'session',
          fullyIdle: true,
          terminationReason: 'model_stop',
        })
      ).toEqual({ kind: 'status', type: 'stop', providerSessionId: 'session' });
    }
  });

  it('ignores intermediate stops, unknown events and missing identity', () => {
    for (const fullyIdle of [false, undefined, 'true']) {
      expect(hooks.parseHookEvent('stop', { conversationId: 'session', fullyIdle })).toEqual({
        kind: 'ignore',
      });
    }
    expect(hooks.parseHookEvent('PostInvocation', { conversationId: 'session' })).toEqual({
      kind: 'ignore',
    });
    expect(hooks.parseHookEvent('start', { conversationId: ' ' })).toEqual({ kind: 'ignore' });
  });

  it('reports terminal errors as failures', () => {
    expect(
      hooks.parseHookEvent('stop', {
        conversationId: 'session',
        fullyIdle: true,
        terminationReason: 'error',
        error: 'Failed to call model',
      })
    ).toEqual({
      kind: 'status',
      type: 'error',
      providerSessionId: 'session',
      message: 'Failed to call model',
    });
  });

  it('forwards authenticated stdin while returning a neutral hook decision', async () => {
    const { fs, read } = createFs();
    await hooks.writeHooks(fs);
    const requests: { type: string | string[] | undefined; body: string }[] = [];
    let responseStatus = 200;
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        expect(req.headers['x-emdash-token']).toBe('test-token');
        expect(req.headers['x-emdash-pty-id']).toBe('test-pty');
        requests.push({ type: req.headers['x-emdash-event-type'], body });
        res.statusCode = responseStatus;
        res.end('{"decision":"continue"}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test server address');
    try {
      for (const [event, expected] of [
        ['PreInvocation', {}],
        ['Stop', { decision: 'stop' }],
      ] as const) {
        const command = read(hooksPath).emdash[event][0].command;
        for (const status of [200, 503]) {
          responseStatus = status;
          const output = promisify(exec)(command, {
            env: {
              ...process.env,
              EMDASH_HOOK_PORT: String(address.port),
              EMDASH_HOOK_NONCE: 'test-token',
              EMDASH_PTY_ID: 'test-pty',
            },
          });
          output.child.stdin!.end('{"conversationId":"session","fullyIdle":true}');
          expect(JSON.parse((await output).stdout)).toEqual(expected);
        }
        const outside = await promisify(exec)(command, {
          env: { ...process.env, EMDASH_HOOK_PORT: '' },
        });
        expect(JSON.parse(outside.stdout)).toEqual(expected);
      }
      expect(requests.map((request) => request.type)).toEqual(['start', 'start', 'stop', 'stop']);
      expect(
        requests.every((request) => JSON.parse(request.body).conversationId === 'session')
      ).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }, 15_000);
});
