import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import type { ResolvedLanguageServer } from './runtime';

const packageRequire = createRequire(import.meta.url);

/** Servers, child processes and their runtime data use physical paths outside ASAR. */
export function unpackedPath(filename: string): string {
  return filename.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
}

/** Resolve shipped assets on the execution host, never against the open project. */
export async function bundledLanguageServer(
  serverId: string,
  env: NodeJS.ProcessEnv
): Promise<ResolvedLanguageServer | undefined> {
  const module =
    serverId === 'typescript'
      ? 'typescript-language-server/lib/cli.mjs'
      : serverId === 'python'
        ? 'pyright/langserver.index.js'
        : undefined;
  if (!module) return undefined;
  const entry = unpackedPath(packageRequire.resolve(module));
  await access(entry);
  return {
    command: process.execPath,
    args: [entry, '--stdio'],
    env: { ...env, ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) },
  };
}
