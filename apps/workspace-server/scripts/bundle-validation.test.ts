import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { inspectBundles } from './bundle-validation';

async function inspect(source: string, chunks: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'emdash-bundle-validation-'));
  onTestFinished(() => rm(directory, { recursive: true, force: true }));
  for (const [name, content] of Object.entries({ 'index.mjs': source, ...chunks })) {
    await writeFile(join(directory, name), content);
  }
  return inspectBundles(directory, ['index.mjs']);
}

describe('workspace-server bundle validation', () => {
  it('ignores the AJV code-generation strings embedded in the Claude SDK', async () => {
    await expect(
      inspect(
        [
          String.raw`const code = "require(\"ajv/dist/runtime/uri\").default";`,
          'const error = codegen`require("ajv/dist/runtime/validation_error").default`;',
          'const formats = codegen`require("ajv-formats/dist/formats").${format}`;',
        ].join('\n')
      )
    ).resolves.toEqual(['index.mjs']);
  });

  it('ignores comments, regular expressions and documentation containing module-load text', async () => {
    await expect(
      inspect(`
        // require(name)
        /* import('not-a-dependency'); __require(name) */
        const help = "require('not-a-dependency')";
        const pattern = /require(name)/;
        const docs = \`
import missing from 'not-a-dependency';
\`;
      `)
    ).resolves.toEqual(['index.mjs']);
  });

  it('accepts bundled chunks, builtins and packaged native dependencies', async () => {
    await expect(
      inspect(
        `
          import 'node:fs';
          import {
            readFile
          } from 'fs/promises';
          export { value } from './chunk.mjs';
          export * from './chunk.mjs';
          await import('./chunk.mjs');
          require('node-pty');
          __require('better-sqlite3');
          module.require('@parcel/watcher');
          require(\`node:path\`);
        `,
        { 'chunk.mjs': 'export const value = 1;' }
      )
    ).resolves.toEqual(['chunk.mjs', 'index.mjs']);
  });

  it.each([
    "import 'unexpected';",
    "import {\n value\n} from 'unexpected';",
    "const first = 1;\nimport value from 'unexpected';",
    "export { value } from 'unexpected';",
    "export * from 'unexpected';",
    "await import('unexpected');",
    "require('unexpected');",
    "__require('unexpected');",
    "module.require('unexpected');",
    "module['require']('unexpected');",
    'require(`unexpected`);',
    String.raw`require('\u0075nexpected');`,
    'const message = `loaded ${require("unexpected")}`;',
    'codegen`loaded ${import("unexpected")}`;',
  ])('rejects executable external module loads: %s', async (source) => {
    await expect(inspect(source)).rejects.toThrow("unexpected external 'unexpected'");
  });

  it.each([
    'require(name);',
    '__require(prefix + name);',
    'module.require(name);',
    'require(`./${name}.mjs`);',
    'await import(name);',
    'await import(`./${name}.mjs`);',
  ])('rejects module loads whose target cannot be verified: %s', async (source) => {
    await expect(inspect(source)).rejects.toThrow(/dynamic (?:require|import) call/);
  });

  it.each(['./missing.mjs', '../index.mjs'])(
    'rejects missing or escaping chunks: %s',
    async (path) => {
      await expect(inspect(`import '${path}';`)).rejects.toThrow(
        `imports missing bundle '${path}'`
      );
    }
  );

  it('inspects shared chunks as well as entry bundles', async () => {
    await expect(
      inspect("import './chunk.mjs';", { 'chunk.mjs': "import 'unexpected';" })
    ).rejects.toThrow("chunk.mjs contains unexpected external 'unexpected'");
  });

  it('rejects missing entry bundles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'emdash-bundle-validation-'));
    onTestFinished(() => rm(directory, { recursive: true, force: true }));
    await expect(inspectBundles(directory, ['index.mjs'])).rejects.toThrow(
      'missing entry bundles: index.mjs'
    );
  });

  it.each(["require('./binding.node');", "const binding = './binding.node';"])(
    'preserves the native binding reference check: %s',
    async (source) => {
      await expect(inspect(source)).rejects.toThrow('native .node binding reference');
    }
  );

  it('rejects invalid JavaScript with the bundle name in the error', async () => {
    await expect(inspect('export const = ;')).rejects.toThrow(/index.mjs.*parse/);
  });
});
