import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { deferred } from '@emdash/shared/testing';
import {
  parseAbsolute,
  type HostAbsolutePath,
  type PortableRelativePath,
} from '@primitives/path/api';
import type { ContentSearchResult } from '@runtimes/file-search/api';
import type { PathIndexEntry } from '@runtimes/file-search/node/storage/path-index-store';
import type { IWatchService } from '@services/fs-watch/api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NodeFileSearchRootResolver } from '../allocation/root-identity';
import { ConcurrencyLimiter } from '../concurrency-limiter';
import { ContentSearchRuntime } from '../content/content-search-runtime';
import type {
  ContentSearchContext,
  FileContentSearcher,
  ResolvedContentSearchInput,
} from '../content/content-searcher';
import { DefaultFileSearchExclusions } from '../exclusions';
import { NodePathScanner, type PathScanner, type PathScanOptions } from '../path-index/scanner';
import { SqlitePathIndexStore } from '../storage/sqlite-path-index-store';
import { FileSearchRootRegistry } from './root-registry';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('FileSearchRootRegistry', () => {
  it('treats persisted watcher attachment as ready without waiting for an initial generation', async () => {
    const rootPath = await createRoot();
    const scanner = new BlockingScanner();
    const { registry } = createRegistry({ scanner });
    const root = absolute(rootPath);

    await expect(registry.registerRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    const state = registry.state(root);
    expect(state.kind).toBe('ready');
    if (state.kind === 'ready') {
      expect(state.resource.searchPaths({ root, query: '', kinds: ['file'] })).toMatchObject({
        success: false,
        error: { type: 'index-not-ready' },
      });
    }
    await scanner.started.promise;
  });

  it('keeps durable registrations when registry shutdown stops maintenance', async () => {
    const rootPath = await createRoot();
    const { registry, store } = createRegistry();
    const root = absolute(rootPath);
    await registry.registerRoot({ root });

    await registry.dispose();

    expect(store.listRoots()).toHaveLength(1);
  });

  it('explicitly removes a persisted root whose restoration failed to start', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const resolver = new NodeFileSearchRootResolver();
    const resolved = await resolver.resolve(root);
    if (!resolved.success) throw new Error('Expected root to resolve');
    const store = new SqlitePathIndexStore({ databasePath: ':memory:' });
    store.upsertRoot(resolved.data);
    await rm(rootPath, { recursive: true, force: true });
    const { registry } = createRegistry({ store });

    await vi.waitFor(() => expect(registry.state(root).kind).toBe('start-failed'));
    await expect(registry.unregisterRoot({ root })).resolves.toEqual({
      success: true,
      data: undefined,
    });
    expect(store.listRoots()).toEqual([]);
    expect(registry.state(root).kind).toBe('not-registered');
  });

  it('rolls back a new durable row when watcher attachment fails', async () => {
    const rootPath = await createRoot();
    const failure = Object.assign(new Error('root disappeared'), { code: 'ENOENT' });
    const { registry, store } = createRegistry({ watcher: new ThrowingWatchService(failure) });

    await expect(registry.registerRoot({ root: absolute(rootPath) })).resolves.toMatchObject({
      success: false,
      error: { type: 'root-unavailable', reason: 'not-found' },
    });
    expect(store.listRoots()).toEqual([]);
  });

  it('cancels and awaits root-scoped content work during explicit unregister', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const searcher = new BlockingContentSearcher();
    const { registry } = createRegistry({ contentSearcher: searcher });
    await registry.registerRoot({ root });
    const content = new ContentSearchRuntime(registry);

    const search = content.searchContent(
      { root, query: 'term' },
      { signal: new AbortController().signal, onProgress: () => {} }
    );
    void search.catch(() => {});
    await searcher.started.promise;
    const unregister = registry.unregisterRoot({ root });

    await searcher.cancelled.promise;
    await expect(search).rejects.toBeDefined();
    await expect(unregister).resolves.toEqual({ success: true, data: undefined });
  });
});

class BlockingScanner implements PathScanner {
  readonly started = deferred<void>();

  async *scan(
    _rootPath: string,
    _relativeRoot: PortableRelativePath,
    options: PathScanOptions
  ): AsyncIterable<PathIndexEntry> {
    this.started.resolve();
    await new Promise<void>((resolve) => {
      if (options.signal.aborted) resolve();
      else options.signal.addEventListener('abort', () => resolve(), { once: true });
    });
    if (!options.signal.aborted) yield { path: _relativeRoot, kind: 'directory' };
  }
}

class BlockingContentSearcher implements FileContentSearcher {
  readonly started = deferred<void>();
  readonly cancelled = deferred<void>();

  search(
    _input: ResolvedContentSearchInput,
    context: ContentSearchContext
  ): Promise<ReturnType<typeof successResult>> {
    this.started.resolve();
    return new Promise((_resolve, reject) => {
      const cancel = (): void => {
        this.cancelled.resolve();
        reject(context.signal.reason);
      };
      if (context.signal.aborted) cancel();
      else context.signal.addEventListener('abort', cancel, { once: true });
    });
  }
}

class NoopWatchService implements IWatchService {
  watch() {
    return { ready: async () => {}, release: async () => {} };
  }

  async dispose(): Promise<void> {}
}

class ThrowingWatchService implements IWatchService {
  constructor(private readonly failure: unknown) {}

  watch(): never {
    throw this.failure;
  }

  async dispose(): Promise<void> {}
}

function createRegistry(
  options: {
    store?: SqlitePathIndexStore;
    scanner?: PathScanner;
    watcher?: IWatchService;
    contentSearcher?: FileContentSearcher;
  } = {}
): { registry: FileSearchRootRegistry; store: SqlitePathIndexStore; scope: Scope } {
  const store = options.store ?? new SqlitePathIndexStore({ databasePath: ':memory:' });
  const scope = createScope({ label: 'root-registry-test' });
  const registry = new FileSearchRootRegistry({
    store,
    watcher: options.watcher ?? new NoopWatchService(),
    scanner: options.scanner ?? new NodePathScanner(),
    resolver: new NodeFileSearchRootResolver(),
    exclusions: new DefaultFileSearchExclusions({ caseSensitive: true }),
    scanLimiter: new ConcurrencyLimiter(1),
    contentLimiter: new ConcurrencyLimiter(1),
    contentSearcher: options.contentSearcher ?? new EmptyContentSearcher(),
    scope,
  });
  cleanups.push(async () => {
    await registry.dispose();
    await scope.dispose();
    store.close();
  });
  return { registry, store, scope };
}

class EmptyContentSearcher implements FileContentSearcher {
  async search() {
    return successResult();
  }
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-root-registry-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  return realpath(directory);
}

function absolute(input: string): HostAbsolutePath {
  const parsed = parseAbsolute(input, {
    profile: { style: path.sep === '\\' ? 'win32' : 'posix' },
  });
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

function successResult() {
  return {
    success: true as const,
    data: { files: [], limitHit: false } satisfies ContentSearchResult,
  };
}
