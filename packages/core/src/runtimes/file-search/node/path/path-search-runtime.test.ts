import { err, ok } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type { PathSearchInput } from '@runtimes/file-search/api';
import { describe, expect, it, vi } from 'vitest';
import type { FileSearchRootLookup, FileSearchRootState } from '../root/root-registry';
import type { RegisteredFileSearchRoot } from '../root/root-resource';
import { hostPath as absolute, relativePath as relative } from '../testing/paths';
import { PathSearchRuntime } from './path-search-runtime';

describe('PathSearchRuntime', () => {
  it('maps root lifecycle states before delegation', async () => {
    const root = absolute('/workspace');

    await expect(searchWith({ kind: 'starting' }, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'index-not-ready' },
    });
    await expect(searchWith({ kind: 'not-registered' }, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
    await expect(
      searchWith(
        {
          kind: 'start-failed',
          error: {
            type: 'root-unavailable',
            root,
            reason: 'not-found',
            message: 'gone',
          },
        },
        root
      )
    ).resolves.toMatchObject({ success: false, error: { type: 'root-unavailable' } });
  });

  it('delegates ready and stop-failed roots without exposing resource internals', async () => {
    const root = absolute('/workspace');
    const searchPaths = vi.fn((_input: PathSearchInput) =>
      ok({ hits: [{ path: relative('src/index.ts'), kind: 'file' as const }] })
    );
    const resource = fakeResource(searchPaths);

    await expect(searchWith({ kind: 'ready', resource }, root)).resolves.toEqual({
      success: true,
      data: { hits: [{ path: 'src/index.ts', kind: 'file' }] },
    });
    await expect(
      searchWith(
        {
          kind: 'stop-failed',
          resource,
          error: { type: 'io', root, message: 'database busy' },
        },
        root
      )
    ).resolves.toMatchObject({ success: true });
    expect(searchPaths).toHaveBeenCalledTimes(2);
  });

  it('lets unexpected resource failures throw', async () => {
    const root = absolute('/workspace');
    const failure = new Error('resource invariant failed');
    const resource = fakeResource(() => {
      throw failure;
    });

    await expect(searchWith({ kind: 'ready', resource }, root)).rejects.toBe(failure);
  });
});

function searchWith(state: FileSearchRootState, root: HostAbsolutePath) {
  const roots: FileSearchRootLookup = { state: () => state };
  return new PathSearchRuntime(roots).searchPaths({ root, query: '', kinds: ['file'] });
}

function fakeResource(
  searchPaths: RegisteredFileSearchRoot['searchPaths']
): RegisteredFileSearchRoot {
  return {
    searchPaths,
    searchContent: async (input) =>
      err({ type: 'root-not-registered', root: input.root, message: 'unused' }),
  };
}
