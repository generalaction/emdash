import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err } from '@emdash/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IExecutionContext } from '#primitives/exec/api';
import { createMemoryKeyValueStore } from '#primitives/kv/api';
import { HostDependenciesRuntime } from './runtime';

describe.skipIf(process.platform === 'win32')('host executable overrides', () => {
  let directory: string;
  let wrapper: string;
  const runtimes: HostDependenciesRuntime[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'emdash-overrides-'));
    wrapper = join(directory, 'custom agent');
    await writeFile(wrapper, '#!/bin/sh\nprintf "wrapper\\n"\n', { mode: 0o755 });
  });

  afterEach(async () => {
    for (const runtime of runtimes.splice(0)) runtime.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  function setup(store = createMemoryKeyValueStore()) {
    const exec = {
      root: '',
      supportsLocalSpawn: true,
      exec: vi.fn(async (command: string, args: string[] = []) => {
        if (command === 'which' && args.includes('custom-agent')) {
          return { stdout: `${wrapper}\n`, stderr: '' };
        }
        if (command === 'which' && args.includes('claude')) {
          return { stdout: `${process.execPath}\n`, stderr: '' };
        }
        throw new Error('not found');
      }),
      execStreaming: vi.fn(),
      dispose: vi.fn(),
    } satisfies IExecutionContext;
    const runtime = new HostDependenciesRuntime({
      hostId: 'test-host',
      definitions: [
        {
          id: 'claude',
          name: 'Claude',
          category: 'agent',
          binaryNames: ['claude'],
          status: 'active',
        },
      ],
      store,
      exec,
    });
    runtimes.push(runtime);
    return { runtime, store, exec };
  }

  it('saves an off-PATH wrapper and resolves it after reloading', async () => {
    const { runtime, store } = setup();
    expect(await runtime.setSelection('claude', { kind: 'path', path: wrapper })).toMatchObject({
      success: true,
      data: { status: 'available', resolved: { path: wrapper } },
    });
    expect(await setup(store).runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: wrapper, source: { kind: 'path', path: wrapper } },
    });
  });

  it('reads existing version-1 path records without rewriting them', async () => {
    const store = createMemoryKeyValueStore();
    await store.set('host-dependencies:test-host:selections', {
      version: 1,
      selections: { claude: { kind: 'path', path: wrapper } },
    });
    const save = vi.spyOn(store, 'set');
    expect(await setup(store).runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: wrapper },
    });
    expect(save).not.toHaveBeenCalled();
  });

  it('accepts an absolute executable in the CLI field', async () => {
    const { runtime } = setup();
    expect(await runtime.resolve('claude', { kind: 'cli', command: wrapper })).toMatchObject({
      success: true,
      data: { path: wrapper },
    });
  });

  it('reports a broken explicit selection without falling back to auto', async () => {
    const { runtime } = setup();
    await runtime.setSelection('claude', { kind: 'path', path: wrapper });
    await rm(wrapper);
    expect(await runtime.resolve('claude')).toMatchObject({
      success: false,
      error: { type: 'invalid-selection' },
    });
  });

  it('rejects a non-executable file without replacing the previous selection', async () => {
    const { runtime } = setup();
    await runtime.setSelection('claude', { kind: 'path', path: wrapper });
    const invalid = join(directory, 'not-executable');
    await writeFile(invalid, 'not executable');
    await chmod(invalid, 0o644);
    expect(await runtime.setSelection('claude', { kind: 'path', path: invalid })).toMatchObject({
      success: false,
      error: { type: 'invalid-selection' },
    });
    expect(await runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: wrapper },
    });
  });

  it('validates without saving, then preserves a command selection across reloads', async () => {
    const { runtime, store, exec } = setup();
    const selection = { kind: 'cli' as const, command: 'custom-agent' };
    expect(await runtime.resolve('claude', selection)).toMatchObject({
      success: true,
      data: { path: wrapper },
    });
    expect(await runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: process.execPath, source: { kind: 'auto' } },
    });
    expect(await runtime.setSelection('claude', selection)).toMatchObject({ success: true });
    expect(await setup(store).runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: wrapper, source: selection },
    });
    expect(exec.exec).toHaveBeenCalledWith('which', ['custom-agent'], expect.any(Object));
    await runtime.setSelection('claude', null);
    expect(await runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { source: { kind: 'auto' } },
    });
  });

  it.each([
    { kind: 'cli' as const, command: 'missing-command' },
    { kind: 'cli' as const, command: 'srt claude' },
    { kind: 'cli' as const, command: '-a' },
    { kind: 'path' as const, path: 'relative/path' },
  ])('rejects invalid selections: %j', async (selection) => {
    const { runtime } = setup();
    expect(await runtime.resolve('claude', selection)).toMatchObject({
      success: false,
      error: { type: 'invalid-selection' },
    });
  });

  it('preserves both the cached and stored selection when saving fails', async () => {
    const { runtime, store } = setup();
    await runtime.setSelection('claude', { kind: 'path', path: wrapper });
    vi.spyOn(store, 'set').mockResolvedValueOnce(err({ type: 'io', message: 'disk full' }));
    expect(await runtime.setSelection('claude', null)).toMatchObject({
      success: false,
      error: { type: 'io', message: 'disk full' },
    });
    expect(await runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: wrapper },
    });
    expect(await setup(store).runtime.resolve('claude')).toMatchObject({
      success: true,
      data: { path: wrapper },
    });
  });

  it('rejects directories and unknown providers', async () => {
    const { runtime } = setup();
    expect(await runtime.resolve('claude', { kind: 'path', path: directory })).toMatchObject({
      success: false,
      error: { type: 'invalid-selection' },
    });
    expect(await runtime.resolve('unknown', { kind: 'path', path: wrapper })).toMatchObject({
      success: false,
      error: { type: 'unknown-dependency' },
    });
  });
});
