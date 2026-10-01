import { createRequire } from 'node:module';
import path from 'node:path';
import type { HostDependencyResolver } from '#primitives/host-dependencies/api';
import { formatAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import type { LspSessionKey } from '../api/schemas';
import { languageServers } from '../api/server-catalog';
import type { ResolvedLanguageServer } from './runtime';

interface HostServerProfile {
  dependencyId: string;
  args: string[];
  rootMarkers: string[];
  configure(
    root: HostAbsolutePath,
    env: NodeJS.ProcessEnv
  ): Promise<{
    initializationOptions?: unknown;
    settings?: Record<string, unknown>;
  }>;
}
const servers: Readonly<Record<string, HostServerProfile>> = {
  typescript: {
    dependencyId: 'typescript-language-server',
    args: ['--stdio'],
    rootMarkers: ['tsconfig.json', 'jsconfig.json', 'package.json'],
    async configure(root) {
      // Resolve the project's toolchain on its host, including hoisted monorepo dependencies.
      let compiler: string | undefined;
      try {
        compiler = createRequire(path.join(formatAbsolute(root), 'package.json')).resolve(
          'typescript/lib/tsserver.js'
        );
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND'))
          throw error;
      }
      return {
        initializationOptions: {
          hostInfo: 'Emdash',
          ...(compiler ? { tsserver: { path: compiler } } : {}),
        },
        settings: { formattingOptions: { tabSize: 2, insertSpaces: true } },
      };
    },
  },
};

export function getServerProfile(id: string): HostServerProfile {
  if (!Object.hasOwn(servers, id)) throw new Error(`Unsupported language server: ${id}`);
  return servers[id];
}

/** Server commands are host-owned descriptors; the renderer selects only an ID. */
export async function resolveLanguageServer(
  key: Pick<LspSessionKey, 'serverId' | 'root'>,
  dependencies: HostDependencyResolver,
  env: NodeJS.ProcessEnv
): Promise<ResolvedLanguageServer> {
  const definition = getServerProfile(key.serverId);
  const resolved = await dependencies.resolve(definition.dependencyId);
  if (!resolved.success)
    throw new Error(
      `${languageServers.find((server) => server.id === key.serverId)?.name ?? key.serverId} language server is unavailable on this host. Install or select it in machine dependencies, then restart language services.`
    );
  return {
    command: resolved.data.path,
    args: [...definition.args],
    env,
    ...(await definition.configure(key.root, env)),
  };
}
