import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { spawnLanguageServer } from './process-transport';
import { LanguageServerSession } from './server-session';

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('language server process transport', () => {
  it('reports a missing executable without hanging or leaking a child', async () => {
    await expect(
      spawnLanguageServer({
        command: '/missing/emdash-language-server',
        args: [],
        cwd: tmpdir(),
        env: process.env,
      })
    ).rejects.toThrow();
  });

  it('bounds requests to a silent process and can dispose it twice', async () => {
    const transport = await spawnLanguageServer({
      command: process.execPath,
      args: ['-e', 'process.stdin.resume()'],
      cwd: tmpdir(),
      env: process.env,
      requestTimeoutMs: 25,
    });
    try {
      await expect(transport.request('initialize', {})).rejects.toThrow(/timed out/i);
      const cancelled = new AbortController();
      cancelled.abort();
      await expect(transport.request('hover', {}, cancelled.signal)).rejects.toThrow();
    } finally {
      await transport.dispose();
      await transport.dispose();
    }
  });

  it('provides real TypeScript hover, definitions and diagnostics using unsaved cross-file buffers', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-'));
    directories.push(root);
    await writeFile(
      path.join(root, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true } })
    );
    await writeFile(path.join(root, 'source.ts'), 'export const value = 123;\n');
    await writeFile(path.join(root, 'consumer.ts'), 'import { value } from "./source";\nvalue;\n');
    const source = pathToFileURL(path.join(root, 'source.ts')).href;
    const consumer = pathToFileURL(path.join(root, 'consumer.ts')).href;
    const resolve = createRequire(import.meta.url).resolve;
    const cli = resolve('typescript-language-server/lib/cli.mjs');
    const tsserver = resolve('typescript/lib/tsserver.js');
    const session = new LanguageServerSession({
      rootUri: pathToFileURL(root).href,
      initializationOptions: { tsserver: { path: tsserver } },
      connect: () =>
        spawnLanguageServer({
          command: process.execPath,
          args: [cli, '--stdio'],
          cwd: root,
          env: process.env,
        }),
    });
    try {
      await session.syncDocument({
        uri: source,
        languageId: 'typescript',
        version: 1,
        text: 'export const value = "unsaved";\n',
      });
      await session.syncDocument({
        uri: consumer,
        languageId: 'typescript',
        version: 1,
        text: 'import { value } from "./source";\nconst wrong: number = value;\nvalue;\n',
      });
      const hover = await session.query('textDocument/hover', consumer, 1, {
        line: 2,
        character: 2,
      });
      expect(JSON.stringify(hover)).toContain('unsaved');
      const definition = await session.query('textDocument/definition', consumer, 1, {
        line: 2,
        character: 2,
      });
      expect(JSON.stringify(definition)).toContain(source);
      await expect
        .poll(
          () =>
            session.current.diagnostics.flatMap((d) => d.diagnostics).some((d) => d.code === 2322),
          { timeout: 10_000 }
        )
        .toBe(true);
      await session.syncDocument({
        uri: consumer,
        languageId: 'typescript',
        version: 2,
        text: 'import { value } from "./source";\nconst correct: string = value;\n',
      });
      await expect
        .poll(() => session.current.diagnostics.find((d) => d.uri === consumer), {
          timeout: 10_000,
        })
        .toMatchObject({
          diagnostics: expect.not.arrayContaining([expect.objectContaining({ code: 2322 })]),
        });
      await session.restart();
      expect(
        JSON.stringify(
          await session.query('textDocument/hover', source, 1, { line: 0, character: 14 })
        )
      ).toContain('unsaved');
    } finally {
      await session.dispose();
    }
  }, 30_000);
});
