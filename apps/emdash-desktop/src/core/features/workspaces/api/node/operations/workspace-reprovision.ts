import { randomUUID } from 'node:crypto';
import { formatHostRef } from '@emdash/core/primitives/host/api';
import { err } from '@emdash/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { ProjectSessionManager } from '@core/features/projects/api/node/project-manager';
import {
  hostReprovisionWorktreeOperation,
  type HostCreateWorktreeInput,
  type HostRemoveWorktreeInput,
} from '@core/features/workspaces/api/node/host-outbox-operations';
import { createWorkspaceRegistry } from '@core/features/workspaces/api/node/registry';
import { deriveBranchName } from '@core/features/workspaces/api/node/workspace-branch';
import type { GitSetup } from '@core/primitives/tasks/api';
import { tasks } from '@core/services/app-db/node/schema';
import type { OperationsEngine } from '@core/services/operations/node';
import {
  compileCreateWorktreePrediction,
  compileRemoveWorktreePrediction,
} from './compile-host-outbox-prediction';

export async function enqueueWorkspaceReprovision(
  operations: OperationsEngine,
  projects: Pick<ProjectSessionManager, 'getProject'>,
  workspaceId: string,
  options: { removeFirst?: boolean } = {}
) {
  const workspace = createWorkspaceRegistry(operations.db).getLive(workspaceId);
  if (!workspace?.path || workspace.kind !== 'worktree' || !workspace.config) {
    return err({
      type: 'workspace-not-reprovisionable',
      message: 'Workspace provenance is incomplete.',
    });
  }
  const [task] = await operations.db
    .select({ projectId: tasks.projectId, name: tasks.name })
    .from(tasks)
    .where(and(eq(tasks.workspaceId, workspaceId), isNull(tasks.deletedAt)))
    .limit(1);
  const project = task ? projects.getProject(task.projectId) : undefined;
  if (!task || !project) {
    return err({ type: 'project-not-found', message: 'Workspace project was not found.' });
  }
  const branchName = deriveBranchName(workspace.config.git);
  if (!branchName) {
    return err({ type: 'branch-not-found', message: 'Workspace branch provenance is missing.' });
  }

  const createdAt = Date.now();
  const hostRef = formatHostRef(project.host);
  const settings = await project.settings.get();
  const git = compileGitOperation(workspace.config.git);
  const createInput: HostCreateWorktreeInput = {
    version: '1',
    source: 'user',
    hostOperationId: randomUUID(),
    hostRef,
    repoPath: project.repoPath,
    projectId: task.projectId,
    workspaceId,
    entityName: task.name,
    workspacePath: workspace.path,
    branchName,
    startPoint: git.startPoint,
    fetch: git.fetch,
    preservePatterns: settings.preservePatterns ?? [],
    prediction: compileCreateWorktreePrediction({
      now: createdAt,
      workspacePath: workspace.path,
      branchName,
      fetch: git.fetch,
      preservePatterns: settings.preservePatterns ?? [],
    }),
    createdAt,
  };

  const removeInput: HostRemoveWorktreeInput = {
    version: '1',
    source: 'user',
    hostOperationId: randomUUID(),
    hostRef,
    repoPath: project.repoPath,
    projectId: task.projectId,
    workspaceId,
    entityName: task.name,
    workspacePath: workspace.path,
    branchName,
    deleteBranch: false,
    deactivateConsumers: 'all',
    prediction: compileRemoveWorktreePrediction({
      now: createdAt,
      workspacePath: workspace.path,
      branchName,
      deleteBranch: false,
      observed: workspace,
    }),
    createdAt,
  };
  return operations.submit(hostReprovisionWorktreeOperation, {
    version: '1',
    source: 'user',
    hostOperationId: randomUUID(),
    hostRef,
    repoPath: project.repoPath,
    projectId: task.projectId,
    workspaceId,
    entityName: task.name,
    workspacePath: workspace.path,
    removeFirst: options.removeFirst ?? false,
    prediction: options.removeFirst ? removeInput.prediction : createInput.prediction,
    createdAt,
    remove: removeInput,
    create: createInput,
  });
}

function compileGitOperation(git: GitSetup): Pick<HostCreateWorktreeInput, 'startPoint' | 'fetch'> {
  if (git.kind === 'create-branch') {
    return {
      startPoint:
        git.fromBranch.type === 'remote'
          ? `${git.fromBranch.remote.name}/${git.fromBranch.branch}`
          : git.fromBranch.branch,
      fetch: git.fromBranch.type === 'remote',
    };
  }
  if (git.kind === 'pr-branch') {
    return { startPoint: git.taskBranch ? git.headBranch : undefined, fetch: true };
  }
  return {};
}
