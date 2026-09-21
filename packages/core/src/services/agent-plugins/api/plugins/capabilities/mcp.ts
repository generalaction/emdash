import { definePluginCapability } from '@emdash/shared/plugins';
import z from 'zod';
import type { McpServerRegistration } from '#primitives/mcp/api';
import type { PluginFs } from '#primitives/plugin-fs/api';
import type { ConfigRootContext } from '../helpers/config-root';

export type IMcpBehavior = {
  readServers(fs: PluginFs): Promise<McpServerRegistration[]>;
  writeServers(fs: PluginFs, servers: McpServerRegistration[]): Promise<void>;
  removeServer(fs: PluginFs, name: string): Promise<void>;
  /**
   * Optional: resolves the root MCP config is read from/written to, the same
   * way hooks' resolveConfigRoots does (e.g. honoring CLAUDE_CONFIG_DIR), so a
   * configured instance with its own env reads/writes its own MCP config
   * instead of the shared default. Providers that omit this keep the prior
   * behavior of always using the host's fixed plugin fs.
   */
  resolveConfigRoot?(context: ConfigRootContext): string;
};

export type { McpServerRegistration } from '#primitives/mcp/api';

export const mcpCapability = definePluginCapability<IMcpBehavior>()(
  'mcp',
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('supported'),
      scope: z.enum(['global']),
      supportedTransports: z.array(z.enum(['stdio', 'http'])),
    }),
    z.object({
      kind: z.literal('none'),
    }),
  ]),
  { kind: 'none' }
);
