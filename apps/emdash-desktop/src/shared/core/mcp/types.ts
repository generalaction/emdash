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

/** Raw server entry as stored in agent config files (used by catalog UI). */
export type RawServerEntry = Record<string, unknown>;

/** Display metadata for a catalog server */
export interface McpCatalogEntry {
  key: string;
  name: string;
  description: string;
  docsUrl: string;
  defaultConfig: RawServerEntry;
  credentialKeys: CredentialKey[];
}

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
