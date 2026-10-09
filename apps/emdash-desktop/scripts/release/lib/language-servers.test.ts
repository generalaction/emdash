import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';
import { verifyLanguageServerAssets } from './language-servers.ts';

it('requires both servers, the TypeScript standard library and Python type stubs inside the deployment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'emdash-language-assets-'));
  try {
    const put = async (name: string, content = '{}') => {
      const file = join(root, name);
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, content);
    };
    await put('package.json');
    await put('node_modules/typescript-language-server/lib/cli.mjs');
    await put('node_modules/typescript/lib/tsserver.js');
    await put('node_modules/typescript/lib/_tsserver.js');
    await put('node_modules/typescript/lib/typescript.js');
    await put('node_modules/typescript/lib/lib.d.ts');
    await put('node_modules/pyright/langserver.index.js');
    await put('node_modules/pyright/dist/typeshed-fallback/stdlib/builtins.pyi');
    expect(() => verifyLanguageServerAssets(root)).not.toThrow();
    await rm(join(root, 'node_modules/typescript/lib/lib.d.ts'));
    expect(() => verifyLanguageServerAssets(root)).toThrow();
    // A nested deployment must not borrow its parent's apparently installed server.
    const nested = join(root, 'nested');
    await put('nested/package.json');
    expect(() => verifyLanguageServerAssets(nested)).toThrow(/outside/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
