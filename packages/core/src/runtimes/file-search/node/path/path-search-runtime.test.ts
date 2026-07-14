import { createScope } from '@emdash/shared/concurrency';
import {
  parseAbsolute,
  parsePortableRelativePath,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@primitives/path/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RootWatchReadyError } from '../path-index/errors';
import type {
  FileSearchRootLookup,
  FileSearchRootState,
  RegisteredFileSearchRoot,
} from '../root/root-registry';
import type { PathIndexStore, PathIndexStoreSearchResult } from '../storage/path-index-store';
import { PathSearchRuntime } from './path-search-runtime';

const disposals: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const dispose of disposals.splice(0).reverse()) await dispose();
});

describe('PathSearchRuntime', () => {
  it('distinguishes registration startup from an unpublished index', async () => {
    const root = absolute('/workspace');
    const store = fakeStore(() => ({ kind: 'not-ready' }));

    await expect(searchWith({ kind: 'starting' }, store, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'index-not-ready' },
    });
    await expect(searchWith(readyRoot(), store, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'index-not-ready' },
    });
    await expect(
      searchWith(
        readyRoot(undefined, () => undefined, false),
        fakeStore(() => ({ kind: 'ready', hits: [{ path: relative('stale.ts'), kind: 'file' }] })),
        root
      )
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'index-not-ready' },
    });
  });

  it('maps expected filesystem and SQLite failures to typed errors', async () => {
    const root = absolute('/workspace');
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
    await expect(searchWith(readyRoot(missing), fakeStore(), root)).resolves.toMatchObject({
      success: false,
      error: { type: 'root-unavailable', reason: 'not-found' },
    });

    const busy = Object.assign(new Error('database busy'), { code: 'SQLITE_BUSY' });
    await expect(
      searchWith(
        readyRoot(),
        fakeStore(() => {
          throw busy;
        }),
        root
      )
    ).resolves.toMatchObject({ success: false, error: { type: 'io' } });

    await expect(
      searchWith(
        readyRoot(new RootWatchReadyError(new Error('remote watcher failed'))),
        fakeStore(),
        root
      )
    ).resolves.toMatchObject({ success: false, error: { type: 'io' } });
  });

  it('checks degradation again after querying so stale hits cannot silently succeed', async () => {
    const root = absolute('/workspace');
    let failure: unknown;
    const state = readyRoot(undefined, () => failure);
    const store = fakeStore(() => {
      failure = Object.assign(new Error('root disappeared'), { code: 'ENOENT' });
      return { kind: 'ready', hits: [{ path: relative('stale.ts'), kind: 'file' }] };
    });

    await expect(searchWith(state, store, root)).resolves.toMatchObject({
      success: false,
      error: { type: 'root-unavailable' },
    });
  });

  it('throws unexpected adapter and invariant failures', async () => {
    const root = absolute('/workspace');
    const bug = new Error('implementation bug');
    await expect(
      searchWith(
        readyRoot(),
        fakeStore(() => {
          throw bug;
        }),
        root
      )
    ).rejects.toBe(bug);
  });
});

function searchWith(state: FileSearchRootState, store: PathIndexStore, root: HostAbsolutePath) {
  const roots: FileSearchRootLookup = { state: () => state };
  return new PathSearchRuntime({ roots, store }).searchPaths({
    root,
    query: '',
    kinds: ['file'],
  });
}

function readyRoot(
  failure?: unknown,
  failureValue: () => unknown = () => failure,
  ready = true
): FileSearchRootState {
  const scope = createScope({ label: 'path-search-runtime-test' });
  disposals.push(() => scope.dispose());
  const registration: RegisteredFileSearchRoot = {
    stored: { id: 1, rootKey: 'root-key', rootPath: '/workspace' },
    index: {
      get failure() {
        return failureValue();
      },
      ready,
    },
    scope,
  };
  return { kind: 'ready', registration };
}

function fakeStore(
  search: () => PathIndexStoreSearchResult = () => ({ kind: 'ready', hits: [] })
): PathIndexStore {
  return {
    listRoots: () => [],
    upsertRoot: vi.fn(),
    deleteRoot: vi.fn(),
    beginBuild: vi.fn(),
    applyPublishedPatches: vi.fn(),
    searchPaths: search,
    close: vi.fn(),
  };
}

function absolute(input: string): HostAbsolutePath {
  const parsed = parseAbsolute(input, { profile: { style: 'posix' } });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function relative(input: string): PortableRelativePath {
  const parsed = parsePortableRelativePath(input);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}
