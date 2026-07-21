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
  enabled?: boolean;
  cwd?: string;
  timeout?: number;
  oauth?: Record<string, unknown> | false;
  providers: string[];
  /**
   * Set by the main process when loading a server whose connection details it
   * manages (see {@link McpCatalogEntry.managed}); ignored on save.
   */
  managed?: boolean;
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
  /**
   * Managed entries are servers emdash itself provides: their connection
   * details are filled in by the main process on save and shown read-only in
   * the add/edit modal.
   */
  managed?: boolean;
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

/** Name of the MCP server entry emdash registers for itself in agent configs. */
export const EMDASH_SELF_SERVER_NAME = 'emdash';
