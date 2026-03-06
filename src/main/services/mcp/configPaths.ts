import os from 'os';
import path from 'path';
import type { AgentMcpMeta, AdapterType } from '@shared/mcp/types';

interface AgentConfigDef {
  pathSegments: string[];
  serversPath: string[];
  template: Record<string, unknown>;
  isToml: boolean;
  adapter: AdapterType;
}

const AGENT_CONFIGS: Record<string, AgentConfigDef> = {
  claude: {
    pathSegments: ['.claude.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
  },
  cursor: {
    pathSegments: ['.cursor', 'mcp.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'cursor',
  },
  codex: {
    pathSegments: ['.codex', 'config.toml'],
    serversPath: ['mcp_servers'],
    template: { mcp_servers: {} },
    isToml: true,
    adapter: 'codex',
  },
  amp: {
    pathSegments: ['.config', 'amp', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
  },
  gemini: {
    pathSegments: ['.gemini', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'gemini',
  },
  qwen: {
    pathSegments: ['.qwen', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'gemini',
  },
  opencode: {
    pathSegments: ['.config', 'opencode', 'opencode.json'],
    serversPath: ['mcp'],
    template: { mcp: {} },
    isToml: false,
    adapter: 'opencode',
  },
  copilot: {
    pathSegments: ['.copilot', 'mcp-config.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'copilot',
  },
  droid: {
    pathSegments: ['.droid', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
  },
};

export function getAgentMcpMeta(agentId: string): AgentMcpMeta | undefined {
  const def = AGENT_CONFIGS[agentId];
  if (!def) return undefined;

  const home = os.homedir();
  return {
    agentId,
    configPath: path.join(home, ...def.pathSegments),
    serversPath: def.serversPath,
    template: def.template,
    isToml: def.isToml,
    adapter: def.adapter,
  };
}

export function getAllMcpAgentIds(): string[] {
  return Object.keys(AGENT_CONFIGS);
}
