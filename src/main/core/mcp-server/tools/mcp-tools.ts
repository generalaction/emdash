/**
 * Registers the `mcp.*` MCP tools — these manage emdash's *outbound* MCP
 * servers (the ones it configures for spawned agents), not the inbound
 * emdash-as-MCP-server itself.
 *
 * Thin adapters over `McpService` (`src/main/core/mcp/services/McpService.ts`):
 *
 *   mcp.list   → `mcpService.loadAll`     (returns installed + catalog)
 *   mcp.add    → `mcpService.saveServer`  (upsert across selected providers)
 *   mcp.remove → `mcpService.removeServer`(removes from every provider that has it)
 *
 * Runtime deps are loaded lazily so constructing the server doesn't trigger
 * MCP config IO at import time.
 */
import type { McpServer as SdkMcpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpLoadAllResponse, McpServer } from '@shared/mcp/types';
import type { mcpService as McpServiceSingleton } from '@main/core/mcp/services/McpService';
import { formatOk, requireConfirm, withRecording } from './_helpers';

// ─── Lazy deps ────────────────────────────────────────────────────────────

type McpDeps = {
  mcpService: typeof McpServiceSingleton;
};

let cachedDeps: McpDeps | null = null;
let cachedDepsPromise: Promise<McpDeps> | null = null;

async function loadDeps(): Promise<McpDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const mod = await import('@main/core/mcp/services/McpService');
    cachedDeps = { mcpService: mod.mcpService };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — for tests: inject a ready-made deps object. */
export function _setMcpDeps(deps: McpDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — for tests: clear cached deps. */
export function _resetMcpDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

// ─── Zod fragments ────────────────────────────────────────────────────────

const transportSchema = z.enum(['stdio', 'http']);

const mcpServerSchema = z.object({
  name: z.string().regex(/^[\w\-._]+$/),
  transport: transportSchema,
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  url: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  providers: z.array(z.string()),
});

// ─── Tool registration ────────────────────────────────────────────────────

export function registerMcpTools(server: SdkMcpServer): void {
  // mcp.list ───────────────────────────────────────────────────────────────
  const listInput = { provider: z.string().optional() };
  server.registerTool(
    'mcp.list',
    {
      title: 'List MCP servers',
      description:
        'List MCP servers emdash has configured for spawned agents. ' +
        'Returns `{ installed, catalog }`. When `provider` is set, only the ' +
        'installed entries that target that provider are returned.',
      inputSchema: listInput,
    },
    withRecording('mcp.list', async (args: z.infer<z.ZodObject<typeof listInput>>) => {
      const deps = await loadDeps();
      const all: McpLoadAllResponse = await deps.mcpService.loadAll();
      if (args.provider) {
        return formatOk({
          installed: all.installed.filter((s) => s.providers.includes(args.provider!)),
          catalog: all.catalog,
        });
      }
      return formatOk(all);
    }) as never
  );

  // mcp.add ────────────────────────────────────────────────────────────────
  const addInput = {
    name: mcpServerSchema.shape.name,
    transport: mcpServerSchema.shape.transport,
    command: mcpServerSchema.shape.command,
    args: mcpServerSchema.shape.args,
    url: mcpServerSchema.shape.url,
    headers: mcpServerSchema.shape.headers,
    env: mcpServerSchema.shape.env,
    providers: mcpServerSchema.shape.providers,
  };
  server.registerTool(
    'mcp.add',
    {
      title: 'Add or update an MCP server',
      description:
        'Add or update an MCP server entry for one or more providers. ' +
        'Upserts: passing a name that already exists overwrites the existing entry.',
      inputSchema: addInput,
    },
    withRecording('mcp.add', async (args: z.infer<z.ZodObject<typeof addInput>>) => {
      const deps = await loadDeps();
      const payload: McpServer = {
        name: args.name,
        transport: args.transport,
        command: args.command,
        args: args.args,
        url: args.url,
        headers: args.headers,
        env: args.env,
        providers: args.providers,
      };
      await deps.mcpService.saveServer(payload);
      return formatOk({ name: args.name, providers: args.providers, saved: true });
    }) as never
  );

  // mcp.remove ─────────────────────────────────────────────────────────────
  const removeInput = {
    name: z.string(),
    // Accepted for API symmetry with the spec, but the underlying service
    // removes the server from every provider that has it — there is no
    // per-provider remove op today.
    providers: z.array(z.string()).optional(),
    confirm: z.boolean().optional(),
  };
  server.registerTool(
    'mcp.remove',
    {
      title: 'Remove an MCP server',
      description:
        'Remove an MCP server entry across providers. Destructive — requires confirm: true. ' +
        'The `providers` argument is currently informational; the entry is removed from every ' +
        'provider that has it.',
      inputSchema: removeInput,
    },
    withRecording('mcp.remove', async (args: z.infer<z.ZodObject<typeof removeInput>>) => {
      const guard = requireConfirm(args, 'remove this MCP server', { name: args.name });
      if (guard) return guard;
      const deps = await loadDeps();
      await deps.mcpService.removeServer(args.name);
      return formatOk({ name: args.name, removed: true });
    }) as never
  );
}

export { registerMcpTools as register };
