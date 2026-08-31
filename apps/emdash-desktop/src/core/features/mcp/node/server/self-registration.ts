import { LOCAL_HOST_REF } from '@emdash/core/primitives/host/api';
import type { McpServer } from '@emdash/core/primitives/mcp/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { err, ok, type Result } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { EMDASH_SELF_SERVER_NAME, isSelfServerEntry } from '@core/primitives/mcp/api';
import type { McpConnectionInfo } from './mcp-http-server';

export type SelfRegistrationDependencies = Readonly<{
  runtimes: RuntimeBroker;
  logger: Logger;
  getConnectionInfo: () => McpConnectionInfo | null;
}>;

/**
 * Builds the Emdash server entry for the given agents from the live server's
 * connection info. The URL and bearer token always come from here — callers (the
 * saveServer intercept, boot reconciliation) only choose providers. `saveServer`
 * removes the entry from any MCP-capable agent not in the list, so an empty
 * providers list deregisters Emdash everywhere.
 */
export function resolveSelfServer(
  dependencies: SelfRegistrationDependencies,
  providers: string[]
): Result<McpServer, string> {
  const info = dependencies.getConnectionInfo();
  if (!info) return err('The Emdash MCP server is not running');
  return ok({
    name: EMDASH_SELF_SERVER_NAME,
    transport: 'http',
    url: info.url,
    headers: { Authorization: `Bearer ${info.token}` },
    providers,
  });
}

/**
 * Boot-time reconciliation: if the user previously registered Emdash in agent
 * configs, rewrite the entry with the current URL and token so token rotation or
 * a port change heals silently. Never creates a registration the user did not
 * opt into.
 *
 * Local host only. The listener binds the desktop's loopback interface, so an
 * agent running on a remote workspace server could not reach it, and writing the
 * entry into that host's agent configs would only produce a broken server.
 */
export async function refreshSelfServerRegistration(
  dependencies: SelfRegistrationDependencies
): Promise<void> {
  if (!dependencies.getConnectionInfo()) return;

  const runtime = await dependencies.runtimes.client(LOCAL_HOST_REF);
  if (!runtime.success) {
    dependencies.logger.warn(
      'McpHttpServer: local runtime unavailable, skipping self-registration'
    );
    return;
  }
  const agentConfig = runtime.data.agentConfig;
  const installed = (await agentConfig.mcpServers.state(undefined, 'list').snapshot()).data;
  const existing = installed.find((server) => server.name === EMDASH_SELF_SERVER_NAME);
  if (!existing || existing.providers.length === 0) return;
  if (!isSelfServerEntry(existing)) {
    dependencies.logger.warn(
      'McpHttpServer: found an unrelated MCP server named "emdash" in agent configs; leaving it untouched'
    );
    return;
  }

  const server = resolveSelfServer(dependencies, existing.providers);
  if (!server.success) return;
  // Always rewrite: the list collapses per-agent entries into one representative,
  // so comparing against it can mask a stale token in another agent's config
  // (e.g. after a partially failed save). saveMcpServer rewrites every agent.
  // Spread the existing entry first so user-set fields (enabled, timeout, cwd)
  // survive the heal; only the connection details are replaced.
  const saved = await agentConfig.saveMcpServer({ server: { ...existing, ...server.data } });
  if (!saved.success) {
    dependencies.logger.warn('McpHttpServer: failed to refresh self-registration', {
      error: saved.error.type,
    });
  }
}
