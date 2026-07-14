import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { ContentSearchProgress } from '@runtimes/file-search/api';
import { afterEach, describe, expect, it } from 'vitest';
import { hostPath as absolute } from '../testing/paths';
import { RipgrepContentSearcher } from './ripgrep-content-searcher';

const hasRipgrep = spawnSync('rg', ['--version'], { stdio: 'ignore' }).status === 0;
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

describe('RipgrepContentSearcher', () => {
  it.skipIf(!hasRipgrep)(
    'groups literal matches by file and line, excludes generated trees, and enforces limits',
    async () => {
      const rootPath = await createRoot();
      await mkdir(path.join(rootPath, 'src'));
      await mkdir(path.join(rootPath, 'node_modules', 'pkg'), { recursive: true });
      await writeFile(path.join(rootPath, 'src', 'index.ts'), 'const 😀 VALUE = 1;\nVALUE VALUE\n');
      await writeFile(path.join(rootPath, 'node_modules', 'pkg', 'hidden.ts'), 'VALUE\n');
      const progress: ContentSearchProgress[] = [];
      const searcher = new RipgrepContentSearcher();

      const result = await searcher.search(
        { root: absolute(rootPath), rootPath, searchPath: rootPath, query: 'value', limit: 2 },
        {
          signal: new AbortController().signal,
          onProgress: (update) => progress.push(update),
        }
      );

      expect(result).toEqual({
        success: true,
        data: {
          files: [
            {
              path: 'src/index.ts',
              matches: [
                {
                  lineNumber: 1,
                  text: 'const 😀 VALUE = 1;',
                  ranges: [{ startColumn: 10, endColumn: 15 }],
                },
                {
                  lineNumber: 2,
                  text: 'VALUE VALUE',
                  ranges: [{ startColumn: 1, endColumn: 6 }],
                },
              ],
            },
          ],
          limitHit: true,
        },
      });
      expect(progress).toHaveLength(1);
      expect(progress[0].files[0].path).toBe('src/index.ts');
    }
  );

  it.skipIf(!hasRipgrep)('treats ripgrep exit one as a successful empty search', async () => {
    const rootPath = await createRoot();
    await writeFile(path.join(rootPath, 'file.ts'), 'nothing here\n');

    await expect(
      new RipgrepContentSearcher().search(
        {
          root: absolute(rootPath),
          rootPath,
          searchPath: rootPath,
          query: 'not-present',
        },
        { signal: new AbortController().signal, onProgress: () => {} }
      )
    ).resolves.toEqual({ success: true, data: { files: [], limitHit: false } });
  });

  it('reports a missing ripgrep executable as an unavailable search engine', async () => {
    const rootPath = await createRoot();
    const result = await new RipgrepContentSearcher({
      executable: path.join(rootPath, 'missing-ripgrep'),
    }).search(
      { root: absolute(rootPath), rootPath, searchPath: rootPath, query: 'term' },
      { signal: new AbortController().signal, onProgress: () => {} }
    );

    expect(result).toMatchObject({
      success: false,
      error: { type: 'content-search-unavailable' },
    });
  });

  it('throws cancellation instead of converting it to an I/O Result', async () => {
    const rootPath = await createRoot();
    const cancellation = new Error('cancel content search');
    const controller = new AbortController();
    controller.abort(cancellation);

    await expect(
      new RipgrepContentSearcher({ executable: process.execPath }).search(
        { root: absolute(rootPath), rootPath, searchPath: rootPath, query: 'term' },
        { signal: controller.signal, onProgress: () => {} }
      )
    ).rejects.toBe(cancellation);
  });

  it.skipIf(!hasRipgrep)('throws unexpected progress observer failures', async () => {
    const rootPath = await createRoot();
    await writeFile(
      path.join(rootPath, 'many.txt'),
      Array.from({ length: 60 }, () => 'VALUE').join('\n')
    );
    const bug = new Error('progress observer bug');

    await expect(
      new RipgrepContentSearcher().search(
        { root: absolute(rootPath), rootPath, searchPath: rootPath, query: 'VALUE' },
        {
          signal: new AbortController().signal,
          onProgress: () => {
            throw bug;
          },
        }
      )
    ).rejects.toBe(bug);
  });
});

async function createRoot(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'emdash-content-search-'));
  temporaryDirectories.push(directory);
  return realpath(directory);
}
