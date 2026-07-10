import { describe, expect, it, vi } from 'vitest';
import { createSpawnContextResolver } from './spawn-context';

describe('createSpawnContextResolver', () => {
  it('resolves cli and allowlisted env', async () => {
    const resolver = createSpawnContextResolver({
      resolveCli: async () => '/usr/local/bin/test-agent',
      env: {
        HOME: '/home/test',
        PATH: '/bin',
        SHELL: '/bin/zsh',
        ANTHROPIC_API_KEY: 'secret',
        UNRELATED: 'ignored',
      },
      homeDir: '/fallback',
      includeShellVar: true,
    });

    const result = await resolver.resolve('test');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toMatchObject({
      cli: '/usr/local/bin/test-agent',
      agentEnv: {
        HOME: '/home/test',
        PATH: '/bin',
        SHELL: '/bin/zsh',
        ANTHROPIC_API_KEY: 'secret',
      },
    });
    expect(result.data.agentEnv).not.toHaveProperty('UNRELATED');
  });

  it('caches resolved cli paths until invalidated', async () => {
    const resolveCli = vi
      .fn<(providerId: string) => Promise<string>>()
      .mockResolvedValueOnce('/first')
      .mockResolvedValueOnce('/second');
    const resolver = createSpawnContextResolver({
      resolveCli,
      env: { PATH: '/bin' },
      homeDir: '/home/test',
    });

    await expect(resolver.resolve('test')).resolves.toMatchObject({
      success: true,
      data: { cli: '/first' },
    });
    await expect(resolver.resolve('test')).resolves.toMatchObject({
      success: true,
      data: { cli: '/first' },
    });
    resolver.invalidate('test');
    await expect(resolver.resolve('test')).resolves.toMatchObject({
      success: true,
      data: { cli: '/second' },
    });
    expect(resolveCli).toHaveBeenCalledTimes(2);
  });

  it('deduplicates concurrent cli resolution', async () => {
    let resolve!: (path: string) => void;
    const resolveCli = vi.fn(
      () =>
        new Promise<string>((ready) => {
          resolve = ready;
        })
    );
    const resolver = createSpawnContextResolver({
      resolveCli,
      env: {},
      homeDir: '/home/test',
    });

    const first = resolver.resolve('test');
    const second = resolver.resolve('test');
    resolve('/bin/test-agent');

    await expect(first).resolves.toMatchObject({ success: true, data: { cli: '/bin/test-agent' } });
    await expect(second).resolves.toMatchObject({ success: true, data: { cli: '/bin/test-agent' } });
    expect(resolveCli).toHaveBeenCalledTimes(1);
  });

  it('returns unknown-provider before resolving cli', async () => {
    const resolveCli = vi.fn<(providerId: string) => Promise<string>>();
    const resolver = createSpawnContextResolver({
      resolveCli,
      hasProvider: () => false,
      env: {},
      homeDir: '/home/test',
    });

    await expect(resolver.resolve('missing')).resolves.toEqual({
      success: false,
      error: { type: 'unknown-provider', providerId: 'missing' },
    });
    expect(resolveCli).not.toHaveBeenCalled();
  });

  it('maps cli resolution failures', async () => {
    const resolver = createSpawnContextResolver({
      resolveCli: async () => {
        throw new Error('not found');
      },
      env: {},
      homeDir: '/home/test',
    });

    await expect(resolver.resolve('test')).resolves.toEqual({
      success: false,
      error: { type: 'cli-not-found', providerId: 'test', message: 'not found' },
    });
  });
});
