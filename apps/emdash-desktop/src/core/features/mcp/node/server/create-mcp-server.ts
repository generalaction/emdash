import type { McpServer } from '@emdash/core/primitives/mcp/api';
import type { Result } from '@emdash/shared';
import type { McpToolDependencies } from './dependencies';
import { McpHttpServer } from './mcp-http-server';
import { buildEmdashMcpServer } from './register-tools';
import {
  refreshSelfServerRegistration,
  resolveSelfServer,
  type SelfRegistrationDependencies,
} from './self-registration';

export type EmdashMcpServerOptions = McpToolDependencies &
  Readonly<{
    /** Absolute path of the file holding the server's bearer token. */
    tokenFilePath: string;
  }>;

export type EmdashMcpServerHandle = Readonly<{
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Connection details for the managed "emdash" entry in agent configs. */
  resolveSelfServer(providers: string[]): Result<McpServer, string>;
  /** Rewrites an existing self-registration with the current URL and token. */
  refreshRegistration(): Promise<void>;
}>;

/**
 * Composition root for the local MCP server: assembles the tool dependencies,
 * the HTTP listener, and the agent-config self-registration into one handle the
 * boot phases can start, stop, and hand to the MCP wire controller.
 */
export function createEmdashMcpServer(options: EmdashMcpServerOptions): EmdashMcpServerHandle {
  const dependencies: McpToolDependencies = options;
  const http = new McpHttpServer({
    tokenFilePath: options.tokenFilePath,
    logger: options.logger,
    buildServer: () => buildEmdashMcpServer(dependencies),
  });
  const registration: SelfRegistrationDependencies = {
    runtimes: options.runtimes,
    logger: options.logger,
    getConnectionInfo: () => http.getConnectionInfo(),
  };
  return {
    start: () => http.start(),
    stop: () => http.stop(),
    resolveSelfServer: (providers) => resolveSelfServer(registration, providers),
    refreshRegistration: () => refreshSelfServerRegistration(registration),
  };
}
