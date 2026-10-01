import type { HostDependencyResolver } from '#primitives/host-dependencies/api';
import type { LspSessionKey } from '../api/schemas';
import type { ResolvedLanguageServer } from './runtime';

const servers = {
  typescript: { dependencyId: 'typescript-language-server', args: ['--stdio'] },
} satisfies Record<LspSessionKey['serverId'], { dependencyId: string; args: string[] }>;

/** Server commands are host-owned descriptors; the renderer selects only an ID. */
export async function resolveLanguageServer(
  id: LspSessionKey['serverId'],
  dependencies: HostDependencyResolver,
  env: NodeJS.ProcessEnv
): Promise<ResolvedLanguageServer> {
  const definition = servers[id];
  const resolved = await dependencies.resolve(definition.dependencyId);
  if (!resolved.success)
    throw new Error(
      'TypeScript language server is unavailable on this host. Install or select it in machine dependencies, then restart language services.'
    );
  return { command: resolved.data.path, args: [...definition.args], env };
}
