import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ok } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import { peek, remote } from '@emdash/wire/state';
import { createTestWire } from '@emdash/wire/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { absoluteEquals, parseNativeAbsolute } from '#primitives/path/api';
import { lspContract } from '../api/contract';
import { selectLanguageServer } from '../api/server-catalog';
import { createLspController } from './controller';
import { LspRuntime } from './runtime';
import { resolveLanguageServer } from './server-registry';

const require = createRequire(import.meta.url);
const executables: Record<string, string> = {
  'bash-language-server': require.resolve('bash-language-server/out/cli.js'),
  'pyright-langserver': require.resolve('pyright/langserver.index.js'),
  'vscode-json-language-server':
    require.resolve('vscode-langservers-extracted/bin/vscode-json-language-server'),
  'vscode-html-language-server':
    require.resolve('vscode-langservers-extracted/bin/vscode-html-language-server'),
  'vscode-css-language-server':
    require.resolve('vscode-langservers-extracted/bin/vscode-css-language-server'),
  'yaml-language-server': require.resolve('yaml-language-server/bin/yaml-language-server'),
};
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function absolute(value: string) {
  const parsed = parseNativeAbsolute(value);
  if (!parsed.success) throw new Error(parsed.error.message);
  return parsed.data;
}

async function fixture(filename: string, text: string, files: Record<string, string> = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'emdash-lsp-languages-'));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  for (const [name, contents] of Object.entries({ ...files, [filename]: text })) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), contents);
  }
  const selected = selectLanguageServer(filename);
  if (!selected) throw new Error(`No server for ${filename}`);
  const scope = createScope();
  cleanups.push(() => scope.dispose());
  const resolve = vi.fn(async (id: string) =>
    ok({
      id,
      command: id,
      path: executables[id] ?? id,
      realpath: executables[id] ?? id,
      source: { kind: 'auto' as const },
    })
  );
  const runtime = new LspRuntime({
    scope,
    lingerMs: 0,
    resolveServer: async (key) => {
      const launch = await resolveLanguageServer(key, { resolve }, process.env);
      // npm fixtures are invoked with this test's Node, including on Windows.
      return Object.values(executables).includes(launch.command)
        ? { ...launch, command: process.execPath, args: [launch.command, ...launch.args] }
        : launch;
    },
  });
  const wire = createTestWire(lspContract, createLspController(runtime), { validate: 'full' });
  cleanups.push(() => wire.dispose());
  const session = {
    clientId: 'languages-test',
    root: absolute(root),
    serverId: selected.server.id,
  };
  const document = {
    path: absolute(path.join(root, filename)),
    languageId: selected.language.languageId,
    version: 1,
    text,
  };
  // Project discovery alone never resolves or launches a process.
  expect(
    await wire.client.resolveProjectRoot({
      workspaceRoot: session.root,
      path: document.path,
      serverId: session.serverId,
    })
  ).toEqual(ok(session.root));
  expect(resolve).not.toHaveBeenCalled();
  const model = remote(lspContract.session, wire.client.session, { lingerMs: 0 });
  cleanups.push(() => model.dispose());
  const release = model.retain(session);
  cleanups.push(release);
  const state = model(session).states.current;
  await state.refresh();
  expect(await wire.client.setDocumentSnapshot({ session, document })).toEqual(ok(undefined));
  expect(resolve).toHaveBeenCalledTimes(1);
  const query = (text: string, needle: string, version = 1) => {
    const offset = text.lastIndexOf(needle);
    if (offset < 0) throw new Error(`Missing ${needle}`);
    const before = text.slice(0, offset);
    return {
      session,
      path: document.path,
      version,
      position: {
        line: before.split('\n').length - 1,
        character: before.length - before.lastIndexOf('\n') - 1,
      },
    };
  };
  return { wire, session, document, query, state, runtime, release };
}

const codeFixtures: {
  language: string;
  filename: string;
  text: string;
  files: Record<string, string>;
  native: boolean;
  types: boolean;
  declarationLine: number;
}[] = [
  {
    language: 'Bash',
    filename: 'main.sh',
    text: '#!/usr/bin/env bash\n# Answer documentation\nanswer() { printf "42"; }\nanswer\n',
    files: {},
    native: false,
    types: false,
    declarationLine: 2,
  },
  {
    language: 'Python',
    filename: 'main.py',
    text: 'class Model:\n    pass\ndef answer() -> Model:\n    return Model()\nitem = answer()\nvalue = item\n',
    files: { 'pyrightconfig.json': '{"typeCheckingMode":"strict"}' },
    native: false,
    types: true,
    declarationLine: 2,
  },
  {
    language: 'Go',
    filename: 'main.go',
    text: 'package main\ntype Model struct { Value int }\nfunc answer() Model { return Model{} }\nfunc main() { item := answer(); _ = item }\n',
    files: { 'go.mod': 'module example.com/lspfixture\n\ngo 1.23\n' },
    native: true,
    types: true,
    declarationLine: 2,
  },
  {
    language: 'Rust',
    filename: 'src/lib.rs',
    text: 'pub struct Model { pub value: i32 }\npub fn answer() -> Model { Model { value: 42 } }\npub fn consume() { let item = answer(); let _ = item; }\n',
    files: {
      'Cargo.toml': '[package]\nname = "lsp-fixture"\nversion = "0.1.0"\nedition = "2021"\n',
    },
    native: true,
    types: true,
    declarationLine: 1,
  },
  {
    language: 'C/C++',
    filename: 'main.cpp',
    text: 'struct Model { int value; };\nModel answer() { return Model{42}; }\nint main() { Model item = answer(); return item.value; }\n',
    files: { 'compile_flags.txt': '-std=c++17\n' },
    native: true,
    types: true,
    declarationLine: 1,
  },
];

describe('installed language servers through production profiles and Wire', () => {
  for (const example of codeFixtures) {
    it.skipIf(example.native && process.env.EMDASH_TEST_NATIVE_LSP !== '1')(
      `${example.language}: navigation, unsaved edits, restart and lease cleanup`,
      async () => {
        const f = await fixture(example.filename, example.text, example.files);
        const query = f.query(example.text, 'answer');
        // Native servers may initialize before finishing their project load.
        await expect
          .poll(async () => JSON.stringify(await f.wire.client.hover(query)), { timeout: 20_000 })
          .toContain('answer');
        const definition = await f.wire.client.definition(query);
        expect(definition.success && definition.data).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: f.document.path,
              range: expect.objectContaining({
                start: expect.objectContaining({ line: example.declarationLine }),
              }),
            }),
          ])
        );
        const references = await f.wire.client.references({ ...query, includeDeclaration: true });
        expect(references.success && references.data.length).toBeGreaterThanOrEqual(2);
        if (example.types) {
          const types = await f.wire.client.typeDefinition(f.query(example.text, 'item'));
          expect(types.success && types.data).toEqual(
            expect.arrayContaining([expect.objectContaining({ path: f.document.path })])
          );
        }
        const updated = example.text.replaceAll('answer', 'renamed');
        expect(
          await f.wire.client.applyDocumentEdit({
            session: f.session,
            change: {
              path: f.document.path,
              baseVersion: 1,
              version: 2,
              edit: { start: 0, deleteCount: example.text.length, text: updated },
            },
          })
        ).toEqual(ok(undefined));
        const changedQuery = f.query(updated, 'renamed', 2);
        await expect
          .poll(async () => JSON.stringify(await f.wire.client.hover(changedQuery)), {
            timeout: 15_000,
          })
          .toContain('renamed');
        expect(await f.wire.client.restartServer(f.session)).toEqual(ok(undefined));
        await expect
          .poll(async () => JSON.stringify(await f.wire.client.hover(changedQuery)), {
            timeout: 20_000,
          })
          .toContain('renamed');
        f.release();
        await expect.poll(() => f.runtime.sessionCount).toBe(0);
      },
      60_000
    );
  }

  it.each([
    {
      filename: 'main.json',
      text: '{"$schema":"./schema.json","answer":"wrong"}',
      needle: 'answer',
      hover: 'Answer documentation',
      diagnostic: 'integer',
    },
    {
      filename: 'tsconfig.json',
      text: '{\n// Allowed JSONC comment\n"$schema":"./schema.json","answer":"wrong"}',
      needle: 'answer',
      hover: 'Answer documentation',
      diagnostic: 'integer',
    },
    {
      filename: 'main.yaml',
      text: '# yaml-language-server: $schema=./schema.json\nanswer: wrong\n',
      needle: 'answer',
      hover: 'Answer documentation',
      diagnostic: 'integer',
    },
    {
      filename: 'main.css',
      text: '.answer { color: red; invalid-property: 1; }',
      needle: 'color',
      hover: 'color',
      diagnostic: 'Unknown property',
    },
    {
      filename: 'main.scss',
      text: '.answer { color: red; invalid-property: 1; }',
      needle: 'color',
      hover: 'color',
      diagnostic: 'Unknown property',
    },
    {
      filename: 'main.less',
      text: '.answer { color: red; invalid-property: 1; }',
      needle: 'color',
      hover: 'color',
      diagnostic: 'Unknown property',
    },
    {
      filename: 'main.html',
      text: '<div>Answer</div>',
      needle: 'div',
      hover: 'div',
      diagnostic: undefined,
    },
  ])(
    '$filename: host hover and diagnostics',
    async (example) => {
      const f = await fixture(example.filename, example.text, {
        'schema.json': JSON.stringify({
          type: 'object',
          properties: {
            answer: { type: 'integer', description: 'Answer documentation' },
          },
        }),
      });
      const hover = await f.wire.client.hover(f.query(example.text, example.needle));
      expect(hover.success && hover.data?.contents).toContain(example.hover);
      if (example.diagnostic) {
        await expect
          .poll(() => JSON.stringify(peek(f.state)?.diagnostics), { timeout: 15_000 })
          .toContain(example.diagnostic);
        const updated = example.text
          .replace('"wrong"', '42')
          .replace(': wrong', ': 42')
          .replace('invalid-property: 1;', '');
        expect(
          await f.wire.client.applyDocumentEdit({
            session: f.session,
            change: {
              path: f.document.path,
              baseVersion: 1,
              version: 2,
              edit: { start: 0, deleteCount: example.text.length, text: updated },
            },
          })
        ).toEqual(ok(undefined));
        // Await an actual empty publication for this document, not the client's immediate invalidation.
        await expect
          .poll(
            () =>
              peek(f.state)?.diagnostics.find((d) => absoluteEquals(d.path, f.document.path))
                ?.diagnostics,
            { timeout: 15_000 }
          )
          .toEqual([]);
      }
    },
    25_000
  );
});
