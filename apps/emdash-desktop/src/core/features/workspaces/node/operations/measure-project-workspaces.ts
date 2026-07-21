import { hostFileRefFromNativePath } from '@core/primitives/desktop-runtime/api';
import type {
  MeasureProjectWorkspacesInput,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsageResult,
} from '@core/primitives/workspaces/api';
import type { WorkspaceRuntimeClient } from '@core/services/runtime-broker/api/clients';
import {
  getProjectWorkspaceProject,
  listProjectWorkspaces,
  mapWithConcurrency,
  type ListProjectWorkspacesDependencies,
} from './list-project-workspaces';

const MEASURE_CONCURRENCY = 4;

export async function measureProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies & {
    getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient>;
  },
  input: MeasureProjectWorkspacesInput
): Promise<MeasureProjectWorkspacesResult> {
  if (input.paths.length === 0) {
    return { scannedAt: new Date().toISOString(), projectId: input.projectId, results: [] };
  }

  const [project, listed] = await Promise.all([
    getProjectWorkspaceProject(dependencies.db, input.projectId),
    listProjectWorkspaces(dependencies, input.projectId),
  ]);
  const rowsByPath = new Map(listed.rows.map((row) => [row.path, row]));
  const results = await mapWithConcurrency(input.paths, MEASURE_CONCURRENCY, async (targetPath) => {
    const row = rowsByPath.get(targetPath);
    if (!row) {
      return {
        path: targetPath,
        success: false,
        message: 'Workspace was not found.',
      } satisfies ProjectWorkspaceUsageResult;
    }
    return await measureRow(dependencies, project.path, row);
  });

  return {
    scannedAt: new Date().toISOString(),
    projectId: input.projectId,
    results,
  };
}

async function measureRow(
  dependencies: { getWorkspaceRuntimeClient(): Promise<WorkspaceRuntimeClient> },
  projectPath: string,
  row: ProjectWorkspaceRow
): Promise<ProjectWorkspaceUsageResult> {
  if (row.pathState === 'remote') {
    return { path: row.path, success: false, message: 'Remote workspaces cannot be measured.' };
  }
  if (row.pathState === 'missing') {
    return { path: row.path, success: false, message: 'Workspace path is missing.' };
  }
  if (row.pathState === 'no-path') {
    return { path: row.path, success: false, message: 'Workspace path is not available.' };
  }

  try {
    const client = await dependencies.getWorkspaceRuntimeClient();
    const usage = await client.measureUsage({
      workspace: hostFileRefFromNativePath(row.path),
      repoPath: hostFileRefFromNativePath(projectPath),
    });
    if (!usage.success) {
      return {
        path: row.path,
        success: false,
        message: usage.error.message,
        errors: [{ path: row.path, message: usage.error.message }],
      };
    }
    return {
      path: row.path,
      success: true,
      usage: {
        totalBytes: usage.data.totalBytes,
        artifactBytes: usage.data.artifactBytes,
        errors: usage.data.errors,
      },
    };
  } catch (error) {
    return {
      path: row.path,
      success: false,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}
