import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { log } from '@main/lib/logger';
import { registerAllResources } from './resources';
import { registerAllTools } from './tools';

const UNKNOWN_VERSION = '0.0.0';

/**
 * Resolves the emdash package version at module load.
 *
 * The MCP SDK's `McpServer` constructor needs the version synchronously, and
 * we want this module to be testable without booting Electron. Reading
 * `package.json` from the repo root works in dev, in unit tests, and in the
 * packaged app (where `package.json` is co-located with the compiled main).
 */
function resolvePackageVersionSync(): string {
  // In the Electron main bundle, `import.meta.url` resolves under `out/main/`.
  // In tests / dev, it resolves under `src/main/core/mcp-server/`. Walk up to
  // the project root looking for the first `package.json` that declares
  // `name: "emdash"`.
  let here: string;
  try {
    here = dirname(fileURLToPath(import.meta.url));
  } catch {
    here = process.cwd();
  }
  const candidates = [
    join(here, '..', '..', '..', '..', 'package.json'),
    join(here, '..', '..', '..', '..', '..', 'package.json'),
    join(process.cwd(), 'package.json'),
  ];
  for (const candidate of candidates) {
    try {
      const raw = readFileSync(candidate, 'utf8');
      const parsed = JSON.parse(raw) as { name?: string; version?: string };
      if (parsed.name === 'emdash' && typeof parsed.version === 'string' && parsed.version) {
        return parsed.version;
      }
    } catch {
      // try next candidate
    }
  }
  log.warn('[mcp-server] could not resolve emdash package version; using fallback');
  return UNKNOWN_VERSION;
}

const PACKAGE_VERSION = resolvePackageVersionSync();

/**
 * Constructs the `@modelcontextprotocol/sdk` `McpServer` instance and wires
 * the curated tool and resource registries into it.
 *
 * The actual tool/resource catalogs are still stubs in T3 — they will be
 * filled in by later tasks (T4+). The service in `service.ts` already
 * tolerates a `null` return so the lifecycle can be exercised before the
 * catalogs exist, but in T3 onwards we always return a real server so the
 * transport has something to connect to.
 */
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: 'emdash',
    version: PACKAGE_VERSION,
  });
  registerAllTools(server);
  registerAllResources(server);
  return server;
}
