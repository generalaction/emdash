import type { HostAbsolutePath } from '@primitives/path/api';
import { describe, expect, it, vi } from 'vitest';
import { hostPath as absolute } from '../testing/paths';
import type { RegisteredRoot } from './registered-root';
import { FileSearchRootRegistry, type FileSearchRootState } from './root-registry';

describe('FileSearchRootRegistry.resolveRegisteredRoot', () => {
  const root = absolute('/workspace');
  const resource = {} as RegisteredRoot;

  it('returns ready and stop-failed registrations', () => {
    expect(resolvePath({ kind: 'ready', resource }, root)).toEqual({
      success: true,
      data: resource,
    });
    expect(
      resolveContent(
        {
          kind: 'stop-failed',
          resource,
          error: { type: 'io', root, message: 'database busy' },
        },
        root
      )
    ).toEqual({ success: true, data: resource });
  });

  it('preserves the operation-specific mapping for a starting registration', () => {
    expect(resolvePath({ kind: 'starting' }, root)).toMatchObject({
      success: false,
      error: { type: 'index-not-ready' },
    });
    expect(resolveContent({ kind: 'starting' }, root)).toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
  });

  it('preserves registration failures and maps missing or stopping roots', () => {
    const failure = {
      type: 'root-unavailable' as const,
      root,
      reason: 'not-found' as const,
      message: 'gone',
    };
    expect(resolvePath({ kind: 'start-failed', error: failure }, root)).toEqual({
      success: false,
      error: failure,
    });
    expect(resolveContent({ kind: 'start-failed', error: failure }, root)).toEqual({
      success: false,
      error: failure,
    });
    for (const state of [{ kind: 'not-registered' }, { kind: 'stopping' }] as const) {
      expect(resolvePath(state, root)).toMatchObject({
        success: false,
        error: { type: 'root-not-registered' },
      });
      expect(resolveContent(state, root)).toMatchObject({
        success: false,
        error: { type: 'root-not-registered' },
      });
    }
  });
});

function registryWith(state: FileSearchRootState): FileSearchRootRegistry {
  const registry = Object.create(FileSearchRootRegistry.prototype) as FileSearchRootRegistry;
  vi.spyOn(registry, 'state').mockReturnValue(state);
  return registry;
}

function resolvePath(state: FileSearchRootState, root: HostAbsolutePath) {
  return registryWith(state).resolveRegisteredRoot(root, { whenStarting: 'index-not-ready' });
}

function resolveContent(state: FileSearchRootState, root: HostAbsolutePath) {
  return registryWith(state).resolveRegisteredRoot(root, {
    whenStarting: 'root-not-registered',
  });
}
