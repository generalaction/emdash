/**
 * Registers the `system.*` MCP tools.
 *
 *   system.listEditors → `appService.checkInstalledApps` (detected app map);
 *                        falls back to the static OPEN_IN_APPS catalog if the
 *                        service throws (e.g. on a non-Electron host).
 *   system.health      → process uptime + emdash version + recent-error count
 *                        from the recent-calls ring buffer.
 *
 * The version is read the same way `server.ts` already does (lazy, sync,
 * walks up from `import.meta.url` looking for the `emdash` package.json) so
 * the two stay in sync without a shared mutable module export.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { OPEN_IN_APPS } from '@shared/openInApps';
import type { appService as AppService } from '@main/core/app/service';
import { recentCallsRing } from '../recent-calls';
import { formatOk, withRecording } from './_helpers';

// ─── Lazy deps ────────────────────────────────────────────────────────────

type SystemDeps = {
  appService: typeof AppService;
};

let cachedDeps: SystemDeps | null = null;
let cachedDepsPromise: Promise<SystemDeps> | null = null;

async function loadDeps(): Promise<SystemDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const mod = await import('@main/core/app/service');
    cachedDeps = { appService: mod.appService };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — for tests: inject a ready-made deps object. */
export function _setSystemDeps(deps: SystemDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — for tests: clear cached deps. */
export function _resetSystemDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

// ─── Version resolution (mirrors server.ts) ───────────────────────────────

const UNKNOWN_VERSION = '0.0.0';

function resolvePackageVersionSync(): string {
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
  return UNKNOWN_VERSION;
}

const PACKAGE_VERSION = resolvePackageVersionSync();

// ─── Tool registration ────────────────────────────────────────────────────

export function registerSystemTools(server: McpServer): void {
  // system.listEditors ─────────────────────────────────────────────────────
  server.registerTool(
    'system.listEditors',
    {
      title: 'List detected editors',
      description:
        'Return the availability map of every editor / terminal emdash knows about ' +
        '(key = app id, value = true if detected). Falls back to the static catalog ' +
        'if detection fails.',
      inputSchema: {},
    },
    withRecording('system.listEditors', async () => {
      try {
        const deps = await loadDeps();
        const availability = await deps.appService.checkInstalledApps();
        return formatOk(availability);
      } catch {
        // Fall back to the static catalog when checkInstalledApps isn't
        // usable (e.g. running outside Electron in a test).
        const fallback: Record<string, boolean> = {};
        for (const id of Object.keys(OPEN_IN_APPS)) fallback[id] = false;
        return formatOk(fallback);
      }
    }) as never
  );

  // system.health ──────────────────────────────────────────────────────────
  server.registerTool(
    'system.health',
    {
      title: 'Server health',
      description:
        'Return basic emdash MCP server health: { name, version, uptimeMs, recentErrorCount }.',
      inputSchema: {},
    },
    withRecording('system.health', async () => {
      const recentErrorCount = recentCallsRing
        .snapshot()
        .filter((c) => c.status === 'error').length;
      return formatOk({
        name: 'emdash',
        version: PACKAGE_VERSION,
        uptimeMs: Math.round(process.uptime() * 1000),
        recentErrorCount,
      });
    }) as never
  );
}

export { registerSystemTools as register };
