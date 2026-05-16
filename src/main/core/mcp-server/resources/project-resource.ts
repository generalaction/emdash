/**
 * Registers two project-scoped resources:
 *
 *   emdash://projects                          (collection)   read-only in v1
 *   emdash://projects/{projectId}/tasks        (template)     read-only in v1
 *
 * Both expose JSON snapshots. Subscribe support is intentionally deferred to
 * v2 — the SDK's `resources/subscribe` handler in `task-session-resource.ts`
 * accepts subscribes for non-PTY URIs but installs no listener, so clients
 * won't error.
 *
 * Runtime deps are loaded lazily so simply constructing an `McpServer`
 * doesn't pull Electron / the DB at import time — same pattern as the tool
 * modules.
 */
import { ResourceTemplate, type McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { LocalProject, SshProject } from '@shared/projects';
import type { Task } from '@shared/tasks';
import { formatResourceContent } from './_helpers';

const COLLECTION_URI = 'emdash://projects';
const TASKS_URI_TEMPLATE = 'emdash://projects/{projectId}/tasks';
const MIME_JSON = 'application/json';

type ProjectResourceDeps = {
  getProjects: () => Promise<(LocalProject | SshProject)[]>;
  getTasks: (projectId?: string) => Promise<Task[]>;
};

let cachedDeps: ProjectResourceDeps | null = null;
let cachedDepsPromise: Promise<ProjectResourceDeps> | null = null;

async function loadDeps(): Promise<ProjectResourceDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const [getProjectsMod, getTasksMod] = await Promise.all([
      import('@main/core/projects/operations/getProjects'),
      import('@main/core/tasks/operations/getTasks'),
    ]);
    cachedDeps = {
      getProjects: getProjectsMod.getProjects,
      getTasks: getTasksMod.getTasks,
    };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — tests inject deps. */
export function _setProjectResourceDeps(deps: ProjectResourceDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — tests reset deps. */
export function _resetProjectResourceDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

export function registerProjectResource(server: McpServer): void {
  // emdash://projects — flat collection.
  server.registerResource(
    'projects',
    COLLECTION_URI,
    {
      title: 'Projects',
      description: 'All projects known to emdash. JSON array of project records.',
      mimeType: MIME_JSON,
    },
    async (uri) => {
      const deps = await loadDeps();
      const projects = await deps.getProjects();
      return formatResourceContent(uri.toString(), MIME_JSON, projects);
    }
  );

  // emdash://projects/{projectId}/tasks — per-project task listing.
  server.registerResource(
    'project-tasks',
    new ResourceTemplate(TASKS_URI_TEMPLATE, { list: undefined }),
    {
      title: 'Tasks for a project',
      description:
        'All tasks belonging to a project. JSON array of task records (mirrors task.list).',
      mimeType: MIME_JSON,
    },
    async (uri, variables) => {
      const projectId = String(variables.projectId ?? '');
      const deps = await loadDeps();
      const tasks = await deps.getTasks(projectId);
      return formatResourceContent(uri.toString(), MIME_JSON, tasks);
    }
  );
}

export { registerProjectResource as register };
