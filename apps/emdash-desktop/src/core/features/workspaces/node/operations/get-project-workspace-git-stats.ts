import type { GitRefsState } from '@emdash/core/runtimes/git/api';
import { runtimeResolveErrorAsError } from '@emdash/core/services/runtime-broker/api';
import type {
  GetProjectWorkspaceGitStatsInput,
  GetProjectWorkspaceGitStatsResult,
  ProjectWorkspaceGitStats,
  ProjectWorkspaceGitStatsResult,
} from '@core/primitives/workspaces/api';
import type { GitRuntimeClient } from '@core/services/runtime-broker/api/clients';
import {
  checkoutSelector,
  gitErrorMessage,
  repositorySelector,
} from '@core/services/runtime-broker/node/git';
import type { WorkspaceScanCache } from '../workspace-scan-cache';
import {
  getProjectWorkspaceProject,
  listProjectWorkspaces,
  mapWithConcurrency,
  projectWorkspaceHost,
  type ListProjectWorkspacesDependencies,
} from './list-project-workspaces';

const GIT_STATS_CONCURRENCY = 4;

export async function getProjectWorkspaceGitStats(
  dependencies: ListProjectWorkspacesDependencies & { workspaceScanCache?: WorkspaceScanCache },
  input: GetProjectWorkspaceGitStatsInput
): Promise<GetProjectWorkspaceGitStatsResult> {
  if (input.paths.length === 0) {
    return { scannedAt: new Date().toISOString(), projectId: input.projectId, results: [] };
  }

  const [project, listed] = await Promise.all([
    getProjectWorkspaceProject(dependencies.db, input.projectId),
    getCachedProjectWorkspaces(dependencies, input.projectId),
  ]);
  const rowsByPath = new Map(listed.rows.map((row) => [row.path, row]));

  const host = projectWorkspaceHost(project);
  const runtime = await dependencies.runtimes.client(host);
  if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);

  const refs = await getRefsSafe(runtime.data.git, project.path);
  const results = await mapWithConcurrency(
    input.paths,
    GIT_STATS_CONCURRENCY,
    async (targetPath): Promise<ProjectWorkspaceGitStatsResult> => {
      const row = rowsByPath.get(targetPath);
      if (!row) return { path: targetPath, success: false, message: 'Workspace was not found.' };
      if (row.pathState === 'missing') {
        return { path: targetPath, success: false, message: 'Workspace path is missing.' };
      }
      if (row.pathState === 'no-path') {
        return { path: targetPath, success: false, message: 'Workspace path is not available.' };
      }

      try {
        const changedFiles = await runtime.data.git.checkout.getChangedFiles({
          ...checkoutSelector(row.path),
          target: { kind: 'working-vs-head' },
        });
        if (!changedFiles.success) throw new Error(gitErrorMessage(changedFiles.error));

        return {
          path: targetPath,
          success: true,
          stats: {
            ...sumChangedFiles(changedFiles.data),
            ...branchDivergence(refs, row.branch),
          },
        };
      } catch (error) {
        return {
          path: targetPath,
          success: false,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }
  );

  const output = {
    scannedAt: new Date().toISOString(),
    projectId: input.projectId,
    results,
  };
  dependencies.workspaceScanCache?.mergeGitStatsResults(input.projectId, output);
  return output;
}

function getCachedProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies & { workspaceScanCache?: WorkspaceScanCache },
  projectId: string
) {
  return dependencies.workspaceScanCache
    ? dependencies.workspaceScanCache.getOrRefresh(projectId, () =>
        listProjectWorkspaces(dependencies, projectId)
      )
    : listProjectWorkspaces(dependencies, projectId);
}

async function getRefsSafe(
  git: GitRuntimeClient,
  projectPath: string
): Promise<GitRefsState | null> {
  try {
    const refs = await git.repository.model
      .state(repositorySelector(projectPath), 'refs')
      .snapshot();
    return refs.data;
  } catch {
    return null;
  }
}

function sumChangedFiles(files: Array<{ additions: number; deletions: number }>) {
  return files.reduce(
    (stats, file) => ({
      added: stats.added + file.additions,
      removed: stats.removed + file.deletions,
    }),
    { added: 0, removed: 0 }
  );
}

function branchDivergence(
  refs: GitRefsState | null,
  branch: string | undefined
): Pick<ProjectWorkspaceGitStats, 'ahead' | 'behind'> {
  const localBranch = refs?.branches.find(
    (candidate) => candidate.type === 'local' && candidate.branch === branch
  );
  return {
    ahead: localBranch?.type === 'local' ? (localBranch.divergence?.ahead ?? 0) : 0,
    behind: localBranch?.type === 'local' ? (localBranch.divergence?.behind ?? 0) : 0,
  };
}
