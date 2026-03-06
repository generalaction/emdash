import os from 'os';
import path from 'path';
import type { AgentMcpMeta, AdapterType } from '@shared/mcp/types';

interface AgentConfigDef {
  pathSegments: string[];
  serversPath: string[];
  template: Record<string, unknown>;
  isToml: boolean;
  adapter: AdapterType;
  supportsHttp: boolean;
}

const AGENT_CONFIGS: Record<string, AgentConfigDef> = {
  claude: {
    pathSegments: ['.claude.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
    supportsHttp: true,
  },
  cursor: {
    pathSegments: ['.cursor', 'mcp.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'cursor',
    supportsHttp: true,
  },
  codex: {
    pathSegments: ['.codex', 'config.toml'],
    serversPath: ['mcp_servers'],
    template: { mcp_servers: {} },
    isToml: true,
    adapter: 'codex',
    supportsHttp: false,
  },
  amp: {
    pathSegments: ['.config', 'amp', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
    supportsHttp: true,
  },
  gemini: {
    pathSegments: ['.gemini', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'gemini',
    supportsHttp: true,
  },
  qwen: {
    pathSegments: ['.qwen', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'gemini',
    supportsHttp: true,
  },
  opencode: {
    pathSegments: ['.config', 'opencode', 'opencode.json'],
    serversPath: ['mcp'],
    template: { mcp: {} },
    isToml: false,
    adapter: 'opencode',
    supportsHttp: true,
  },
  copilot: {
    pathSegments: ['.copilot', 'mcp-config.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'copilot',
    supportsHttp: true,
  },
  droid: {
    pathSegments: ['.droid', 'settings.json'],
    serversPath: ['mcpServers'],
    template: { mcpServers: {} },
    isToml: false,
    adapter: 'passthrough',
    supportsHttp: true,
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

export function agentSupportsHttp(agentId: string): boolean {
  return AGENT_CONFIGS[agentId]?.supportsHttp ?? true;
}
