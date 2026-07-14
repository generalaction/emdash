import { err, ok } from '@emdash/shared';
import type { HostAbsolutePath } from '@primitives/path/api';
import type { ContentSearchInput, ContentSearchResult } from '@runtimes/file-search/api';
import { describe, expect, it, vi } from 'vitest';
import type { FileSearchRootLookup, FileSearchRootState } from '../root/root-registry';
import type { RegisteredFileSearchRoot } from '../root/root-resource';
import { hostPath as absolute } from '../testing/paths';
import { ContentSearchRuntime } from './content-search-runtime';
import type { ContentSearchContext } from './content-searcher';

describe('ContentSearchRuntime', () => {
  it('delegates content search to ready and stop-failed roots', async () => {
    const root = absolute('/workspace');
    const searchContent = vi.fn(
      async (_input: ContentSearchInput, _context: ContentSearchContext) => ok(emptyResult())
    );
    const resource = fakeResource(searchContent);

    await expect(searchWith({ kind: 'ready', resource }, root)).resolves.toEqual({
      success: true,
      data: emptyResult(),
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
    expect(searchContent).toHaveBeenCalledTimes(2);
  });

  it('maps unavailable lifecycle states before delegation', async () => {
    const root = absolute('/workspace');

    await expect(searchWith({ kind: 'not-registered' }, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
    await expect(searchWith({ kind: 'starting' }, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });
  });

  it('lets unexpected resource failures throw', async () => {
    const root = absolute('/workspace');
    const failure = new Error('content resource invariant failed');
    const resource = fakeResource(() => Promise.reject(failure));

    await expect(searchWith({ kind: 'ready', resource }, root)).rejects.toBe(failure);
  });
});

function searchWith(state: FileSearchRootState, root: HostAbsolutePath) {
  const roots: FileSearchRootLookup = { state: () => state };
  return new ContentSearchRuntime(roots).searchContent(
    { root, query: 'term' },
    { signal: new AbortController().signal, onProgress: () => {} }
  );
}

function fakeResource(
  searchContent: RegisteredFileSearchRoot['searchContent']
): RegisteredFileSearchRoot {
  return {
    searchPaths: (input) => err({ type: 'index-not-ready', root: input.root, message: 'unused' }),
    searchContent,
  };
}

function emptyResult(): ContentSearchResult {
  return { files: [], limitHit: false };
}
