/**
 * Registers the `project.*` MCP tools.
 *
 * Thin adapters over the project operation functions in
 * `src/main/core/projects/operations/` and `project-settings-service`. No
 * business logic lives here. Same conventions as `task-tools.ts`:
 *
 *   project.add            → `createProject`              (operations/createProject.ts)
 *   project.list           → `getProjects`                (operations/getProjects.ts)
 *   project.get            → `getProjectById` + settings + remoteState
 *   project.updateSettings → `projectSettingsService.updateProjectSettings`
 *   project.delete         → `deleteProject`              (operations/deleteProject.ts)
 *
 * Runtime deps are loaded lazily so constructing an `McpServer` doesn't
 * pull Electron / the DB at import time.
 */
import { randomUUID } from 'node:crypto';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { baseProjectSettingsSchema } from '@shared/project-settings';
import type {
  CreateProjectParams,
  LocalProject,
  Project,
  ProjectRemoteState,
  SshProject,
  UpdateProjectSettingsError,
} from '@shared/projects';
import type { Result } from '@shared/result';
import type { projectManager as ProjectManager } from '@main/core/projects/project-manager';
import type { projectSettingsService as ProjectSettingsService } from '@main/core/projects/settings/project-settings-service';
import { formatErr, formatOk, fromResult, requireConfirm, withRecording } from './_helpers';

// ─── Lazy deps ────────────────────────────────────────────────────────────

type ProjectDeps = {
  createProject: (params: CreateProjectParams) => Promise<LocalProject | SshProject>;
  getProjects: () => Promise<(LocalProject | SshProject)[]>;
  getProjectById: (projectId: string) => Promise<LocalProject | SshProject | undefined>;
  deleteProject: (id: string) => Promise<void>;
  projectManager: typeof ProjectManager;
  projectSettingsService: typeof ProjectSettingsService;
};

let cachedDeps: ProjectDeps | null = null;
let cachedDepsPromise: Promise<ProjectDeps> | null = null;

async function loadDeps(): Promise<ProjectDeps> {
  if (cachedDeps) return cachedDeps;
  if (cachedDepsPromise) return cachedDepsPromise;
  cachedDepsPromise = (async () => {
    const [createProjectMod, getProjectsMod, deleteProjectMod, projectManagerMod, settingsMod] =
      await Promise.all([
        import('@main/core/projects/operations/createProject'),
        import('@main/core/projects/operations/getProjects'),
        import('@main/core/projects/operations/deleteProject'),
        import('@main/core/projects/project-manager'),
        import('@main/core/projects/settings/project-settings-service'),
      ]);
    cachedDeps = {
      createProject: createProjectMod.createProject,
      getProjects: getProjectsMod.getProjects,
      getProjectById: getProjectsMod.getProjectById,
      deleteProject: deleteProjectMod.deleteProject,
      projectManager: projectManagerMod.projectManager,
      projectSettingsService: settingsMod.projectSettingsService,
    };
    return cachedDeps;
  })();
  return cachedDepsPromise;
}

/** @internal — for tests: inject a ready-made deps object. */
export function _setProjectDeps(deps: ProjectDeps): void {
  cachedDeps = deps;
  cachedDepsPromise = Promise.resolve(deps);
}

/** @internal — for tests: clear cached deps. */
export function _resetProjectDeps(): void {
  cachedDeps = null;
  cachedDepsPromise = null;
}

// ─── Zod fragments ────────────────────────────────────────────────────────

const addInput = {
  path: z.string().optional(),
  ssh: z
    .object({
      connectionId: z.string(),
      remotePath: z.string(),
    })
    .optional(),
  name: z.string().optional(),
  // Accepted for API symmetry with the spec; the underlying operation
  // currently resolves the base ref itself, so this field is informational.
  baseRef: z.string().optional(),
};

const updateSettingsInput = {
  projectId: z.string(),
  // We validate the patch against the *base* settings schema only — the
  // shareable bits go through a different write path (`shareProjectSettingsToConfig`).
  // `.strict()` rejects unknown keys.
  patch: baseProjectSettingsSchema.strict(),
};

// ─── Tool registration ────────────────────────────────────────────────────

export function registerProjectTools(server: McpServer): void {
  // project.add ────────────────────────────────────────────────────────────
  server.registerTool(
    'project.add',
    {
      title: 'Add project',
      description:
        'Add a local project (Git repo path) or a remote SSH project. ' +
        'Exactly one of `path` or `ssh` must be provided. ' +
        'Returns the persisted project record.',
      inputSchema: addInput,
    },
    withRecording('project.add', async (args: z.infer<z.ZodObject<typeof addInput>>) => {
      const hasPath = typeof args.path === 'string' && args.path.length > 0;
      const hasSsh = !!args.ssh;
      if (hasPath && hasSsh) {
        return formatErr(
          'INVALID_ARGS',
          'Provide exactly one of `path` (local) or `ssh` (remote), not both.'
        );
      }
      if (!hasPath && !hasSsh) {
        return formatErr('INVALID_ARGS', 'Provide either `path` (local) or `ssh` (remote).');
      }

      const deps = await loadDeps();
      // `name` is required by the underlying op; default to the last path
      // segment when the caller omits it.
      const derivePathName = (p: string): string => {
        const trimmed = p.replace(/\/+$/, '');
        const idx = trimmed.lastIndexOf('/');
        return idx >= 0 ? trimmed.slice(idx + 1) : trimmed;
      };

      let params: CreateProjectParams;
      if (hasPath) {
        params = {
          type: 'local',
          id: randomUUID(),
          path: args.path!,
          name: args.name ?? derivePathName(args.path!),
        };
      } else {
        params = {
          type: 'ssh',
          id: randomUUID(),
          path: args.ssh!.remotePath,
          name: args.name ?? derivePathName(args.ssh!.remotePath),
          connectionId: args.ssh!.connectionId,
        };
      }

      const project = await deps.createProject(params);
      return formatOk(project);
    }) as never
  );

  // project.list ───────────────────────────────────────────────────────────
  server.registerTool(
    'project.list',
    {
      title: 'List projects',
      description: 'Return all projects (local + SSH), sorted by most recently updated.',
      inputSchema: {},
    },
    withRecording('project.list', async () => {
      const deps = await loadDeps();
      const projects = await deps.getProjects();
      return formatOk(projects);
    }) as never
  );

  // project.get ────────────────────────────────────────────────────────────
  const getInput = { projectId: z.string() };
  server.registerTool(
    'project.get',
    {
      title: 'Get project',
      description:
        'Return a project record with its current settings and remote state. ' +
        'Settings and remotes are best-effort — both may be `null` if the project is not mounted.',
      inputSchema: getInput,
    },
    withRecording('project.get', async (args: z.infer<z.ZodObject<typeof getInput>>) => {
      const deps = await loadDeps();
      const project: Project | undefined = await deps.getProjectById(args.projectId);
      if (!project) {
        return formatErr('NOT_FOUND', `Project not found: ${args.projectId}`, {
          projectId: args.projectId,
        });
      }
      const provider = deps.projectManager.getProject(args.projectId);
      let settings: unknown = null;
      let remotes: ProjectRemoteState | null = null;
      if (provider) {
        try {
          settings = await provider.settings.get();
        } catch {
          settings = null;
        }
        try {
          remotes = await provider.getRemoteState();
        } catch {
          remotes = null;
        }
      }
      return formatOk({ project, settings, remotes });
    }) as never
  );

  // project.updateSettings ─────────────────────────────────────────────────
  server.registerTool(
    'project.updateSettings',
    {
      title: 'Update project settings',
      description:
        'Patch base project settings (worktreeDirectory, defaultBranch, baseRemote, ' +
        'pushRemote, tmux, workspaceProvider). Unknown keys are rejected. ' +
        'Shareable settings (preservePatterns, shellSetup, scripts) go through a ' +
        'different write path and are not editable here.',
      inputSchema: updateSettingsInput,
    },
    withRecording(
      'project.updateSettings',
      async (args: z.infer<z.ZodObject<typeof updateSettingsInput>>) => {
        const deps = await loadDeps();
        // Merge the patch onto current settings so the underlying op gets
        // the full ProjectSettings shape it expects.
        const provider = deps.projectManager.getProject(args.projectId);
        if (!provider) {
          return formatErr('NOT_FOUND', `Project not mounted: ${args.projectId}`, {
            projectId: args.projectId,
          });
        }
        const current = await provider.settings.get();
        const merged = { ...current, ...args.patch };
        const result: Result<unknown, UpdateProjectSettingsError> =
          await deps.projectSettingsService.updateProjectSettings(args.projectId, merged);
        return fromResult(result);
      }
    ) as never
  );

  // project.delete ─────────────────────────────────────────────────────────
  const deleteInput = {
    projectId: z.string(),
    confirm: z.boolean().optional(),
  };
  server.registerTool(
    'project.delete',
    {
      title: 'Delete project',
      description:
        'Remove a project from emdash (does NOT touch the on-disk repo). ' +
        'Destructive — requires confirm: true.',
      inputSchema: deleteInput,
    },
    withRecording('project.delete', async (args: z.infer<z.ZodObject<typeof deleteInput>>) => {
      const guard = requireConfirm(args, 'delete this project', { projectId: args.projectId });
      if (guard) return guard;
      const deps = await loadDeps();
      const existing = await deps.getProjectById(args.projectId);
      if (!existing) {
        return formatErr('NOT_FOUND', `Project not found: ${args.projectId}`, {
          projectId: args.projectId,
        });
      }
      await deps.deleteProject(args.projectId);
      return formatOk({ projectId: args.projectId, deleted: true });
    }) as never
  );
}

export { registerProjectTools as register };
