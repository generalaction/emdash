import { z } from 'zod';

export const mcpServerSchema = z.object({
  name: z.string(),
  transport: z.enum(['stdio', 'http']),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  enabled: z.boolean().optional(),
  cwd: z.string().optional(),
  timeout: z.number().optional(),
  oauth: z.union([z.record(z.string(), z.unknown()), z.literal(false)]).optional(),
  providers: z.array(z.string()),
});

export type McpServer = z.infer<typeof mcpServerSchema>;

export interface CredentialKey {
  key: string;
  required: boolean;
}

export type RawServerEntry = Record<string, unknown>;

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
