/**
 * Registers the `emdash://tasks/{taskId}` resource — read-only task detail.
 *
 * No per-id `getTask` operation exists today, so we filter the project-wide
 * listing (same pattern as the `task.get` tool). Subscriptions are deferred
 * to v2 — the shared subscribe handler in `task-session-resource.ts` will
 * silently accept the request and install no listener.
 */
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Task } from '@shared/tasks';
import { formatResourceContent } from './_helpers';

const URI_TEMPLATE = 'emdash://tasks/{taskId}';
const MIME_JSON = 'application/json';

type TaskResourceDeps = {
  getTasks: (projectId?: string) => Promise<Task[]>;
};

let cachedDeps: TaskResourceDeps | null = null;
let cachedDepsPromise: Promise<TaskResourceDeps> | null = null;

async function loadDeps(): Promise<TaskResourceDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const getTasksMod = await import('@main/core/tasks/operations/getTasks');
    cachedDeps = { getTasks: getTasksMod.getTasks };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — tests inject deps. */
export function _setTaskResourceDeps(deps: TaskResourceDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — tests reset deps. */
export function _resetTaskResourceDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

export function registerTaskResource(server: McpServer): void {
  server.registerResource(
    'task',
    new ResourceTemplate(URI_TEMPLATE, { list: undefined }),
    {
      title: 'Task detail',
      description:
        'Single-task detail by id. JSON record matching the task.get tool. ' +
        'Returns an empty JSON null payload when the task is unknown.',
      mimeType: MIME_JSON,
    },
    async (uri, variables) => {
      const taskId = String(variables.taskId ?? '');
      const deps = await loadDeps();
      const all = await deps.getTasks();
      const found = all.find((t) => t.id === taskId) ?? null;
      return formatResourceContent(uri.toString(), MIME_JSON, found);
    }
  );
}

export { registerTaskResource as register };
