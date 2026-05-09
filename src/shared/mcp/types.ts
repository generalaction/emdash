/** Canonical MCP server — the normalized shape Emdash uses internally */
export interface McpServer {
  name: string;
  transport: 'stdio' | 'http';
  // stdio
  command?: string;
  args?: string[];
  // http
  url?: string;
  headers?: Record<string, string>;
  // common
  env?: Record<string, string>;
  providers: string[];
}

/** Credential key with required/optional distinction */
export interface CredentialKey {
  key: string;
  required: boolean;
}

/** Display metadata for a catalog server */
export interface McpCatalogEntry {
  key: string;
  name: string;
  description: string;
  docsUrl: string;
  defaultConfig: RawServerEntry;
  credentialKeys: CredentialKey[];
}

/** Raw server entry as stored in agent config files */
export type RawServerEntry = Record<string, unknown>;

/** Map of server name → raw config */
export type ServerMap = Record<string, RawServerEntry>;

/** Agent MCP config metadata — how to navigate each agent's config file */
export interface AgentMcpMeta {
  agentId: string;
  configPath: string;
  serversPath: string[];
  template: Record<string, unknown>;
  isToml: boolean;
  adapter: AdapterType;
}

export type AdapterType = 'passthrough' | 'gemini' | 'cursor' | 'codex' | 'opencode' | 'copilot';

export interface McpLoadAllResponse {
  installed: McpServer[];
  catalog: McpCatalogEntry[];
}

export interface McpProvidersResponse {
  id: string;
  name: string;
  installed: boolean;
  supportsHttp: boolean;
}
