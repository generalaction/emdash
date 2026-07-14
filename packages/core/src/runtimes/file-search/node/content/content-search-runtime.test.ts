import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { parseAbsolute, type HostAbsolutePath } from '@primitives/path/api';
import type { ContentSearchResult } from '@runtimes/file-search/api';
import { afterEach, describe, expect, it } from 'vitest';
import { ConcurrencyLimiter } from '../concurrency-limiter';
import type {
  FileSearchRootLookup,
  FileSearchRootState,
  RegisteredFileSearchRoot,
} from '../root/root-registry';
import { ContentSearchRuntime } from './content-search-runtime';
import type {
  ContentSearchContext,
  FileContentSearcher,
  ResolvedContentSearchInput,
} from './content-searcher';

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe('ContentSearchRuntime', () => {
  it('runs independently of path-index readiness and supplies resolved defaults', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const searcher = new RecordingSearcher();
    const runtime = createRuntime(
      readyRoot(rootPath, new Error('index still unavailable')),
      searcher
    );

    await expect(
      runtime.searchContent(
        { root, query: 'term' },
        { signal: new AbortController().signal, onProgress: () => {} }
      )
    ).resolves.toEqual({ success: true, data: emptyResult() });
    expect(searcher.inputs).toEqual([
      expect.objectContaining({ rootPath, searchPath: rootPath, limit: 1_000 }),
    ]);
  });

  it('returns ordering errors but lets unexpected searcher failures throw', async () => {
    const rootPath = await createRoot();
    const root = absolute(rootPath);
    const notRegistered = createRuntime({ kind: 'not-registered' }, new RecordingSearcher());
    await expect(
      notRegistered.searchContent(
        { root, query: 'term' },
        { signal: new AbortController().signal, onProgress: () => {} }
      )
    ).resolves.toMatchObject({
      success: false,
      error: { type: 'root-not-registered' },
    });

    const bug = new Error('search adapter bug');
    const broken = createRuntime(readyRoot(rootPath), {
      search: () => Promise.reject(bug),
    });
    await expect(
      broken.searchContent(
        { root, query: 'term' },
        { signal: new AbortController().signal, onProgress: () => {} }
      )
    ).rejects.toBe(bug);
  });
});

class RecordingSearcher implements FileContentSearcher {
  readonly inputs: ResolvedContentSearchInput[] = [];

  async search(input: ResolvedContentSearchInput, _context: ContentSearchContext) {
    this.inputs.push(input);
    return ok(emptyResult());
  }
}

function createRuntime(state: FileSearchRootState, searcher: FileContentSearcher) {
  const roots: FileSearchRootLookup = { state: () => state };
  return new ContentSearchRuntime({ roots, searcher, limiter: new ConcurrencyLimiter(1) });
}

function readyRoot(rootPath: string, failure?: unknown): FileSearchRootState {
  const scope = createScope({ label: 'content-search-runtime-test' });
  cleanups.push(() => scope.dispose());
  const registration: RegisteredFileSearchRoot = {
    stored: { id: 1, rootKey: 'root-key', rootPath },
    index: { failure, ready: false },
    scope,
  };
  return { kind: 'ready', registration };
}

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-content-runtime-'));
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

function emptyResult(): ContentSearchResult {
  return { files: [], limitHit: false };
}
