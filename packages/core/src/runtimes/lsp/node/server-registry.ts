import { createRequire } from 'node:module';
import path from 'node:path';
import type { HostDependencyResolver } from '#primitives/host-dependencies/api';
import { formatAbsolute, type HostAbsolutePath } from '#primitives/path/api';
import type { LspSessionKey } from '../api/schemas';
import { languageServers } from '../api/server-catalog';
import { bundledLanguageServer, unpackedPath } from './bundled-language-servers';
import { pythonSettings } from './python-settings';
import type { ResolvedLanguageServer } from './runtime';

interface HostServerProfile {
  dependencyId: string;
  args: string[];
  rootMarkers: string[];
  configure?(
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
        if (
          !(
            error instanceof Error &&
            'code' in error &&
            (error.code === 'MODULE_NOT_FOUND' || error.code === 'ERR_PACKAGE_PATH_NOT_EXPORTED')
          )
        )
          throw error;
      }
      // Projects without a compatible tsserver use the one shipped with the app.
      compiler ??= createRequire(import.meta.url).resolve('typescript/lib/tsserver.js');
      return {
        initializationOptions: {
          hostInfo: 'Emdash',
          disableAutomaticTypingAcquisition: true,
          tsserver: { path: unpackedPath(compiler) },
        },
        settings: { formattingOptions: { tabSize: 2, insertSpaces: true } },
      };
    },
  },
  bash: { dependencyId: 'bash-language-server', args: ['start'], rootMarkers: [] },
  go: { dependencyId: 'gopls', args: [], rootMarkers: ['go.work', 'go.mod'] },
  rust: {
    dependencyId: 'rust-analyzer',
    args: [],
    rootMarkers: ['Cargo.toml', 'rust-project.json'],
  },
  python: {
    dependencyId: 'pyright-langserver',
    args: ['--stdio'],
    rootMarkers: [
      'pyrightconfig.json',
      'pyproject.toml',
      'setup.py',
      'setup.cfg',
      'requirements.txt',
      'Pipfile',
    ],
    configure: async (root, env) => ({ settings: await pythonSettings(root, env) }),
  },
  cpp: {
    dependencyId: 'clangd',
    args: [],
    rootMarkers: ['compile_commands.json', 'compile_flags.txt', '.clangd', 'CMakeLists.txt'],
  },
  json: {
    dependencyId: 'vscode-json-language-server',
    args: ['--stdio'],
    rootMarkers: [],
  },
  yaml: { dependencyId: 'yaml-language-server', args: ['--stdio'], rootMarkers: [] },
  html: { dependencyId: 'vscode-html-language-server', args: ['--stdio'], rootMarkers: [] },
  css: {
    dependencyId: 'vscode-css-language-server',
    args: ['--stdio'],
    rootMarkers: [],
    // This server expects an object for each dialect's workspace/configuration section.
    configure: async () => ({
      settings: {
        css: { validate: true },
        scss: { validate: true },
        less: { validate: true },
      },
    }),
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
  // A user's explicit selection wins. Automatic discovery uses the pinned bundled server;
  // a stale/invalid selection must remain visible rather than silently changing toolchains.
  if (
    (resolved.success && resolved.data.source.kind === 'auto') ||
    (!resolved.success && resolved.error.type === 'missing')
  ) {
    const bundled = await bundledLanguageServer(key.serverId, env);
    if (bundled) {
      return {
        ...bundled,
        ...(await definition.configure?.(key.root, env)),
      };
    }
  }
  if (!resolved.success)
    throw new Error(
      `${languageServers.find((server) => server.id === key.serverId)?.name ?? key.serverId} language server is unavailable on this host. Install or select it in machine dependencies, then restart language services.`
    );
  return {
    command: resolved.data.path,
    args: [...definition.args],
    env,
    ...(await definition.configure?.(key.root, env)),
  };
}
