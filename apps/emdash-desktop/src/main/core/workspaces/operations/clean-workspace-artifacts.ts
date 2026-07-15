import { workspaceContract } from '@emdash/core/runtimes/workspace/api';
import { runRuntimeLiveJob } from '@main/core/runtime/live-job';
import {
  getWorkspaceRuntimeClient,
  hostFileRefFromNativePath,
} from '@main/core/workspaces/runtime/workspace-runtime-host';
import { projectManager } from '@main/core/projects/project-manager';
import { defaultShareableProjectSettings } from '@shared/core/project-settings/project-settings';
import type {
  ProjectWorkspaceActionResult,
  ProjectWorkspaceActionSummary,
  ProjectWorkspaceRow,
} from '@shared/core/workspaces/project-workspaces';
import { getProjectWorkspaceProject, listProjectWorkspaces } from './list-project-workspaces';

export async function cleanWorkspaceArtifacts(
  input: {
    projectId: string;
    paths: string[];
  }
): Promise<ProjectWorkspaceActionSummary> {
  if (input.paths.length === 0) return { succeededCount: 0, failedCount: 0, results: [] };

  const [project, rows, preservePatterns] = await Promise.all([
    getProjectWorkspaceProject(input.projectId),
    listProjectWorkspaces(input.projectId),
    getPreservePatterns(input.projectId),
  ]);
  const rowsByPath = new Map(rows.rows.map((row) => [row.path, row]));
  const results: ProjectWorkspaceActionResult[] = [];

  for (const targetPath of input.paths) {
    const row = rowsByPath.get(targetPath);
    if (!row) {
      results.push({
        path: targetPath,
        success: false,
        reason: 'workspace-not-found',
        message: 'Workspace was not found.',
      });
      continue;
    }
    results.push(await cleanWorkspaceArtifactsRow(project.path, row, preservePatterns));
  }

  const succeededCount = results.filter((result) => result.success).length;
  return {
    succeededCount,
    failedCount: results.length - succeededCount,
    results,
  };
}

async function cleanWorkspaceArtifactsRow(
  projectPath: string,
  row: ProjectWorkspaceRow,
  preservePatterns: string[]
): Promise<ProjectWorkspaceActionResult> {
  if (!row.canCleanArtifacts) {
    return {
      path: row.path,
      workspaceId: row.workspaceId ?? undefined,
      success: false,
      reason: row.pathState === 'missing' ? 'missing-path' : 'unsupported-workspace',
      message:
        row.pathState === 'missing'
          ? 'Workspace path is missing.'
          : 'This workspace does not support artifact cleanup.',
    };
  }

  const client = await getWorkspaceRuntimeClient();
  const result = await runRuntimeLiveJob(workspaceContract.cleanArtifacts, client.cleanArtifacts, {
    workspace: hostFileRefFromNativePath(row.path),
    repoPath: hostFileRefFromNativePath(projectPath),
    preservePatterns,
  });

  if (!result.success) {
    return {
      path: row.path,
      workspaceId: row.workspaceId ?? undefined,
      success: false,
      reason: 'clean-failed',
      message: result.error.message,
    };
  }

  return {
    path: row.path,
    workspaceId: row.workspaceId ?? undefined,
    success: true,
    reclaimedBytes: result.data.reclaimedBytes,
  };
}

async function getPreservePatterns(projectId: string): Promise<string[]> {
  const project = projectManager.getProject(projectId);
  const defaults = defaultShareableProjectSettings().preservePatterns ?? [];
  if (!project) return [...defaults];
  const settings = await project.settings.get();
  return settings.preservePatterns ?? [...defaults];
}
