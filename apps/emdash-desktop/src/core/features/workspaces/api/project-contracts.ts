import { defineContract, procedure } from '@emdash/wire';
import { z } from 'zod';
import type { ProjectSettingsLoadResult } from '@core/primitives/project-settings/api';
import type {
  GetProjectWorkspaceGitStatsInput,
  GetProjectWorkspaceGitStatsResult,
  MeasureProjectWorkspacesInput,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspacesResult,
} from '@core/primitives/workspaces/api';

export const projectSettingsContract = defineContract({
  getSettings: procedure({
    input: z.object({ workspaceId: z.string() }),
    output: z.custom<ProjectSettingsLoadResult>(),
  }),
});

export const projectWorkspacesContract = defineContract({
  listProjectWorkspaces: procedure({
    input: z.object({ projectId: z.string() }),
    output: z.custom<ProjectWorkspacesResult>(),
  }),
  measureProjectWorkspaces: procedure({
    input: z.custom<MeasureProjectWorkspacesInput>(),
    output: z.custom<MeasureProjectWorkspacesResult>(),
  }),
  getProjectWorkspaceGitStats: procedure({
    input: z.custom<GetProjectWorkspaceGitStatsInput>(),
    output: z.custom<GetProjectWorkspaceGitStatsResult>(),
  }),
  deleteProjectWorkspaces: procedure({
    input: z.object({
      projectId: z.string(),
      paths: z.array(z.string()),
      deleteConversations: z.boolean().optional(),
    }),
    output: z.custom<ProjectWorkspaceActionSummary>(),
  }),
  invalidateWorkspaceScanCache: procedure({
    input: z.object({ projectId: z.string().optional(), path: z.string().optional() }),
    output: z.void(),
  }),
});
