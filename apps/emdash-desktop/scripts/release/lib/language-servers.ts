import { accessSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, sep } from 'node:path';

/** Fail packaging before signing if language-server runtime assets are missing. */
export function verifyLanguageServerAssets(directory: string): void {
  const root = realpathSync(directory);
  const asset = (filename: string): string => {
    const inside = relative(root, realpathSync(filename));
    if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`))
      throw new Error(`Language-server asset was resolved outside the deployment: ${filename}`);
    accessSync(filename);
    return filename;
  };
  const requireApp = createRequire(join(directory, 'package.json'));
  asset(requireApp.resolve('typescript-language-server/lib/cli.mjs'));
  asset(requireApp.resolve('typescript/lib/tsserver.js'));
  asset(requireApp.resolve('typescript/lib/_tsserver.js'));
  asset(requireApp.resolve('typescript/lib/typescript.js'));
  asset(requireApp.resolve('typescript/lib/lib.d.ts'));
  asset(requireApp.resolve('pyright/langserver.index.js'));
  asset(requireApp.resolve('pyright/dist/typeshed-fallback/stdlib/builtins.pyi'));
}
