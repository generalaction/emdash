import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { HostAbsolutePath, PortableRelativePath } from '@primitives/path/api';
import type { ContentSearchResult } from '@runtimes/file-search/api';
import type { IWatchService } from '@services/fs-watch/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConcurrencyLimiter } from '../concurrency-limiter';
import type {
  ContentSearchContext,
  FileContentSearcher,
  ResolvedContentSearchInput,
} from '../content/content-searcher';
import { DefaultFileSearchExclusions } from '../exclusions';
import type { PathScanner, PathScanOptions } from '../path-index/scanner';
import type {
  PathIndexBuild,
  PathIndexEntry,
  PathIndexStore,
  PathIndexStoreSearchResult,
} from '../storage/path-index-store';
import { hostPath as absolute } from '../testing/paths';
import { FileSearchRootResource } from './root-resource';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('FileSearchRootResource', () => {
  it('maps expected scan and store failures while throwing invariant failures', async () => {
    const root = absolute('/workspace');
    const missing = Object.assign(new Error('gone'), { code: 'ENOENT' });
    const failedScan = createResource('/workspace', {
      scanner: new FailingScanner(missing),
    });
    await vi.waitFor(() => {
      expect(failedScan.resource.searchPaths(pathInput(root))).toMatchObject({
        success: false,
        error: { type: 'root-unavailable', reason: 'not-found' },
      });
    });

    const busy = Object.assign(new Error('database busy'), { code: 'SQLITE_BUSY' });
    const busyStore = new FakePathIndexStore(() => {
      throw busy;
    });
    const busyResource = createResource('/workspace', { store: busyStore }).resource;
    await waitForPublished(busyStore);
    expect(busyResource.searchPaths(pathInput(root))).toMatchObject({
      success: false,
      error: { type: 'io' },
    });

    const invariant = new Error('path-index invariant failed');
    const brokenStore = new FakePathIndexStore(() => {
      throw invariant;
    });
    const brokenResource = createResource('/workspace', { store: brokenStore }).resource;
    await waitForPublished(brokenStore);
    expect(() => brokenResource.searchPaths(pathInput(root))).toThrow(invariant);
  });

  it('runs content search before path-index publication and applies resolved defaults', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const searcher = new RecordingContentSearcher();
    const { resource } = createResource(rootPath, {
      scanner: new BlockingScanner(),
      searcher,
    });

    await expect(
      resource.searchContent(
        { root, query: 'term' },
        { signal: new AbortController().signal, onProgress: () => {} }
      )
    ).resolves.toEqual({ success: true, data: emptyContentResult() });
    expect(searcher.inputs).toEqual([
      expect.objectContaining({ rootPath, searchPath: rootPath, limit: 1_000 }),
    ]);
  });
});

class FakePathIndexStore implements PathIndexStore {
  published = false;

  constructor(
    private readonly search: () => PathIndexStoreSearchResult = () => ({
      kind: 'ready',
      hits: [],
    })
  ) {}

  listRoots() {
    return [];
  }

  upsertRoot(): never {
    throw new Error('unused');
  }

  deleteRoot(): void {}

  beginBuild(): PathIndexBuild {
    return {
      append: () => {},
      publish: () => {
        this.published = true;
      },
      discard: () => {},
    };
  }

  applyPublishedPatches(): void {}

  searchPaths(): PathIndexStoreSearchResult {
    return this.search();
  }

  close(): void {}
}

class EmptyScanner implements PathScanner {
  async *scan(): AsyncIterable<PathIndexEntry> {}
}

class FailingScanner implements PathScanner {
  constructor(private readonly failure: unknown) {}

  async *scan(): AsyncIterable<PathIndexEntry> {
    throw this.failure;
  }
}

class BlockingScanner implements PathScanner {
  async *scan(
    _rootPath: string,
    _relativeRoot: PortableRelativePath,
    options: PathScanOptions
  ): AsyncIterable<PathIndexEntry> {
    await new Promise<void>((resolve) => {
      if (options.signal.aborted) resolve();
      else options.signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }
}

class RecordingContentSearcher implements FileContentSearcher {
  readonly inputs: ResolvedContentSearchInput[] = [];

  async search(input: ResolvedContentSearchInput, _context: ContentSearchContext) {
    this.inputs.push(input);
    return ok(emptyContentResult());
  }
}

class EmptyContentSearcher implements FileContentSearcher {
  async search() {
    return ok(emptyContentResult());
  }
}

class NoopWatchService implements IWatchService {
  watch() {
    return { ready: async () => {}, release: async () => {} };
  }

  async dispose(): Promise<void> {}
}

function createResource(
  rootPath: string,
  options: {
    store?: FakePathIndexStore;
    scanner?: PathScanner;
    searcher?: FileContentSearcher;
  } = {}
) {
  const scope = createScope({ label: 'file-search-root-resource-test' });
  cleanups.push(() => scope.dispose());
  const store = options.store ?? new FakePathIndexStore();
  const resource = new FileSearchRootResource({
    root: { id: 1, rootKey: 'root-key', rootPath },
    store,
    watcher: new NoopWatchService(),
    scanner: options.scanner ?? new EmptyScanner(),
    exclusions: new DefaultFileSearchExclusions({ caseSensitive: true }),
    scope,
    scanLimiter: new ConcurrencyLimiter(1),
    contentLimiter: new ConcurrencyLimiter(1),
    contentSearcher: options.searcher ?? new EmptyContentSearcher(),
  });
  return { resource, store };
}

async function waitForPublished(store: FakePathIndexStore): Promise<void> {
  await vi.waitFor(() => expect(store.published).toBe(true));
}

function pathInput(root: HostAbsolutePath) {
  return { root, query: '', kinds: ['file' as const] };
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-root-resource-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

function emptyContentResult(): ContentSearchResult {
  return { files: [], limitHit: false };
}
