import {
  hostAbsolutePathSchema,
  portableRelativePathSchema,
} from '@emdash/core/primitives/path/api';
import { fileTreeModelSchema, fsErrorSchema } from '@emdash/core/runtimes/files/api';
import { workspaceErrorSchema } from '@emdash/core/runtimes/workspace/api';
import type { Result } from '@emdash/shared';
import {
  defineContract,
  eventStream,
  fallible,
  liveJob,
  liveModel,
  liveState,
  mutation,
  procedure,
} from '@emdash/wire';
import z from 'zod';
import { workspaceBootstrapProgressSchema } from '@core/features/workspaces/api';
import {
  deletionListSchema,
  deletionModelKeySchema,
  deletionMutationErrorSchema,
  deletionMutationResultSchema,
} from '@core/primitives/operations/api';
import type {
  MigrateProjectConfigRequest,
  MigrateProjectConfigResult,
  ProjectSettings,
  ProjectSettingsPage,
  ProjectSettingsPatch,
  WriteProjectConfigRequest,
} from '@core/primitives/project-settings/api';
import {
  localProjectSchema,
  type CreateProjectParams,
  type CreateProjectResult,
  type InitializeRepositoryResult,
  type InspectProjectPathParams,
  type OpenProjectError,
  type OpenProjectSuccess,
  type Project,
  type ProjectPlacementError,
  type ProjectPathInspection,
  type ResolveRepositoryDestinationParams,
  type UpdateProjectSettingsError,
} from '@core/primitives/projects/api';

export const projectCreationStateSchema = z.discriminatedUnion('phase', [
  z.object({
    phase: z.literal('cloning'),
    message: z.string().optional(),
  }),
  z.object({
    phase: z.literal('initializing'),
    message: z.string().optional(),
  }),
  z.object({
    phase: z.literal('registering'),
    message: z.string().optional(),
  }),
  z.object({
    phase: z.literal('ready'),
    project: localProjectSchema,
  }),
  z.object({
    phase: z.literal('error'),
    message: z.string(),
    error: workspaceErrorSchema.optional(),
  }),
]);

export const projectCreationKeySchema = z.object({
  projectId: z.string(),
});

export const createProjectFromRemoteInputSchema = z.object({
  projectId: z.string(),
  mode: z.enum(['clone', 'new']),
  repositoryUrl: z.string().min(1),
  targetPath: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
});

export const projectHostParamsSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('local') }),
  z.object({ type: z.literal('ssh'), connectionId: z.string().min(1) }),
]);

export const projectDirectoryTreeKeySchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('local'),
    root: hostAbsolutePathSchema,
    sessionId: z.string(),
  }),
  z.object({
    type: z.literal('ssh'),
    connectionId: z.string().min(1),
    root: hostAbsolutePathSchema,
    sessionId: z.string(),
  }),
]);

const projectIdInputSchema = z.object({
  projectId: z.string(),
});

export const projectsWireContract = defineContract({
  createProject: procedure({
    input: z.custom<CreateProjectParams>(),
    output: z.custom<CreateProjectResult>(),
  }),
  inspectProjectPath: procedure({
    input: z.custom<InspectProjectPathParams>(),
    output: z.custom<ProjectPathInspection>(),
  }),
  initializeRepository: procedure({
    input: projectIdInputSchema,
    output: z.custom<InitializeRepositoryResult>(),
  }),
  getHostHomeDir: procedure({
    input: projectHostParamsSchema,
    output: z.string(),
  }),
  createHostDirectory: fallible({
    input: z.object({
      host: projectHostParamsSchema,
      root: hostAbsolutePathSchema,
      path: portableRelativePathSchema,
    }),
    data: z.void(),
    error: fsErrorSchema,
  }),
  resolveRepositoryDestination: procedure({
    input: z.custom<ResolveRepositoryDestinationParams>(),
    output: z.custom<Result<string, ProjectPlacementError>>(),
  }),
  getProjects: procedure({
    input: z.void(),
    output: z.custom<Project[]>(),
  }),
  deleteProject: procedure({
    input: projectIdInputSchema,
    output: z.void(),
  }),
  getProjectSettingsPage: procedure({
    input: projectIdInputSchema,
    output: z.custom<Result<ProjectSettingsPage, UpdateProjectSettingsError>>(),
  }),
  updateProjectSettings: procedure({
    input: z.object({
      projectId: z.string(),
      settings: z.custom<ProjectSettings>(),
    }),
    output: z.custom<Result<ProjectSettings, UpdateProjectSettingsError>>(),
  }),
  patchProjectSettings: procedure({
    input: z.object({
      projectId: z.string(),
      patch: z.custom<ProjectSettingsPatch>(),
    }),
    output: z.custom<Result<ProjectSettings, UpdateProjectSettingsError>>(),
  }),
  shareProjectSettingsToConfig: procedure({
    input: z.object({
      projectId: z.string(),
      request: z.custom<WriteProjectConfigRequest>(),
    }),
    output: z.custom<Result<ProjectSettingsPage, UpdateProjectSettingsError>>(),
  }),
  migrateProjectConfig: procedure({
    input: z.object({
      projectId: z.string(),
      request: z.custom<MigrateProjectConfigRequest>(),
    }),
    output: z.custom<Result<MigrateProjectConfigResult, UpdateProjectSettingsError>>(),
  }),
  countProjectsUsingGithubAccount: procedure({
    input: z.object({ accountId: z.string() }),
    output: z.number(),
  }),
  updateProjectConnection: procedure({
    input: z.object({ projectId: z.string(), connectionId: z.string() }),
    output: z.void(),
  }),
  openProject: procedure({
    input: projectIdInputSchema,
    output: z.custom<Result<OpenProjectSuccess, OpenProjectError>>(),
  }),
  events: eventStream({
    key: z.void(),
    event: z.object({ type: z.literal('settings-changed'), projectId: z.string() }),
  }),
  creation: liveModel({
    key: projectCreationKeySchema,
    states: {
      state: liveState({ data: projectCreationStateSchema }),
    },
  }),
  directoryTree: liveModel({
    key: projectDirectoryTreeKeySchema,
    states: {
      tree: liveState({ data: fileTreeModelSchema }),
    },
    mutations: {
      expand: mutation({
        input: z.object({
          path: portableRelativePathSchema,
          depth: z.number().int().min(1).max(2).optional(),
        }),
        data: z.void(),
        error: fsErrorSchema,
      }),
      collapse: mutation({
        input: z.object({ path: portableRelativePathSchema }),
        data: z.void(),
        error: fsErrorSchema,
      }),
      reveal: mutation({
        input: z.object({
          path: portableRelativePathSchema,
          depth: z.number().int().min(1).max(2).optional(),
        }),
        data: z.void(),
        error: fsErrorSchema,
      }),
    },
  }),
  create: liveJob({
    input: createProjectFromRemoteInputSchema,
    progress: workspaceBootstrapProgressSchema,
    result: localProjectSchema,
    error: workspaceErrorSchema,
  }),
  delete: fallible({
    input: projectIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  retryDelete: fallible({
    input: projectIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  forgetWithoutCleanup: fallible({
    input: projectIdInputSchema,
    data: deletionMutationResultSchema,
    error: deletionMutationErrorSchema,
  }),
  deletions: liveModel({
    key: deletionModelKeySchema,
    states: {
      list: liveState({ data: deletionListSchema }),
    },
  }),
});

export type ProjectCreationState = z.infer<typeof projectCreationStateSchema>;
export type CreateProjectFromRemoteInput = z.infer<typeof createProjectFromRemoteInputSchema>;
export type ProjectHostParams = z.infer<typeof projectHostParamsSchema>;
export type ProjectsWireContract = typeof projectsWireContract;
