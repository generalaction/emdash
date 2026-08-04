import { hostRefKey } from '@emdash/core/primitives/host/api';
import { parseAbsolute } from '@emdash/core/primitives/path/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import type {
  MeasureProjectWorkspacesInput,
  MeasureProjectWorkspacesResult,
  ProjectWorkspaceRow,
  ProjectWorkspaceUsageResult,
} from '@core/primitives/workspaces/api';
import type { WorkspaceScanCache } from '../workspace-scan-cache';
import {
  getProjectWorkspaceProject,
  listProjectWorkspaces,
  mapWithConcurrency,
  projectWorkspaceHost,
  type ListProjectWorkspacesDependencies,
} from './list-project-workspaces';

const MEASURE_CONCURRENCY = 4;

export async function measureProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies & { workspaceScanCache?: WorkspaceScanCache },
  input: MeasureProjectWorkspacesInput
): Promise<MeasureProjectWorkspacesResult> {
  if (input.paths.length === 0) {
    return { scannedAt: new Date().toISOString(), projectId: input.projectId, results: [] };
  }

  const project = await getProjectWorkspaceProject(dependencies.db, input.projectId);
  const listed = await getCachedProjectWorkspaces(
    dependencies,
    input.projectId,
    hostRefKey(projectWorkspaceHost(project))
  );
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
    return await measureRow(dependencies, project, row);
  });

  const output = {
    scannedAt: new Date().toISOString(),
    projectId: input.projectId,
    results,
  };
  dependencies.workspaceScanCache?.mergeUsageResults(input.projectId, results);
  return output;
}

function getCachedProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies & { workspaceScanCache?: WorkspaceScanCache },
  projectId: string,
  hostId: string
) {
  return dependencies.workspaceScanCache
    ? dependencies.workspaceScanCache.getOrRefresh(
        projectId,
        () => listProjectWorkspaces(dependencies, projectId),
        { hostId }
      )
    : listProjectWorkspaces(dependencies, projectId);
}

async function measureRow(
  dependencies: { runtimes: Pick<RuntimeBroker, 'client'> },
  project: Awaited<ReturnType<typeof getProjectWorkspaceProject>>,
  row: ProjectWorkspaceRow
): Promise<ProjectWorkspaceUsageResult> {
  if (row.pathState === 'missing') {
    return { path: row.path, success: false, message: 'Workspace path is missing.' };
  }
  if (row.pathState === 'no-path') {
    return { path: row.path, success: false, message: 'Workspace path is not available.' };
  }

  try {
    const host = projectWorkspaceHost(project);
    const runtime = await dependencies.runtimes.client(host);
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    const workspacePath = parseAbsolute(row.path);
    if (!workspacePath.success) {
      return { path: row.path, success: false, message: workspacePath.error.message };
    }
    const usage = await runtime.data.workspaceHost.measureUsage({
      workspacePath: workspacePath.data,
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
