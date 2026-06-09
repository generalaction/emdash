// packages/cli-agent-plugins/helpers/mcp.ts
import { parse as parseTOML, stringify as stringifyTOML } from 'smol-toml';

import type { McpServerRegistration } from '../core/capabilities';
import type { CLIAgentPluginFs } from '../core/plugin';

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>(
      (cur, key) =>
        cur != null && typeof cur === 'object'
          ? (cur as Record<string, unknown>)[key]
          : undefined,
      obj
    );
}

function setNestedValue(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<Record<string, unknown>>((cur, key) => {
    if (cur[key] == null || typeof cur[key] !== 'object') cur[key] = {};
    return cur[key] as Record<string, unknown>;
  }, obj);
  target[last] = value;
}

type McpConfigShape = {
  configPath: string;
  format: 'json' | 'toml';
  serversKey: string; // e.g. 'mcpServers', 'mcp_servers', 'mcp'
  toNative(server: McpServerRegistration): Record<string, unknown>;
  fromNative(name: string, raw: Record<string, unknown>): McpServerRegistration;
};

export function createMcpAdapter(shape: McpConfigShape) {
  return {
    async readServers(fs: CLIAgentPluginFs): Promise<McpServerRegistration[]> {
      const content = await fs.read(shape.configPath);
      if (!content) return [];
      const parsed = shape.format === 'json' ? JSON.parse(content) : parseTOML(content);
      const servers = getNestedValue(parsed, shape.serversKey) ?? {};
      return Object.entries(servers).map(([name, raw]) =>
        shape.fromNative(name, raw as Record<string, unknown>)
      );
    },
    async writeServers(fs: CLIAgentPluginFs, servers: McpServerRegistration[]): Promise<void> {
      const content = await fs.read(shape.configPath);
      const parsed = content
        ? (shape.format === 'json' ? JSON.parse(content) : parseTOML(content))
        : {};
      const native = Object.fromEntries(servers.map((s) => [s.name, shape.toNative(s)]));
      setNestedValue(parsed, shape.serversKey, native);
      const output = shape.format === 'json'
        ? JSON.stringify(parsed, null, 2) + '\n'
        : stringifyTOML(parsed);
      await fs.write(shape.configPath, output);
    },
    async removeServer(fs: CLIAgentPluginFs, name: string): Promise<void> {
      const servers = await this.readServers(fs);
      await this.writeServers(fs, servers.filter((s) => s.name !== name));
    },
  };
}

/** Passthrough adapter — agent uses the same format as canonical */
export const passthroughMcpAdapter = (configPath: string) =>
  createMcpAdapter({
    configPath,
    format: 'json',
    serversKey: 'mcpServers',
    toNative: (s) => {
      const { name, ...rest } = s;
      return rest;
    },
    fromNative: (name, raw) => ({ name, ...raw } as McpServerRegistration),
  });