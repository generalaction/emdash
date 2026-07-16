import { and, eq, isNull } from 'drizzle-orm';
import type { FilesClientScope } from '@main/core/files/runtime-client';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import {
  projects as projectsTable,
  tasks as tasksTable,
  workspaces as workspacesTable,
} from '@main/db/schema';
import type {
  ProjectSettingsWriteTarget,
  ProjectSettingsWriteTargetOption,
  WriteProjectConfigRequest,
} from '@shared/core/project-settings/project-settings';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import type { ProjectProvider } from '../../project-provider';
import { resolveWorkspace } from '../../utils';

export type ProjectSettingsResolvedTarget = ProjectSettingsWriteTargetOption & {
  files: FilesClientScope;
  configPath: string;
};

function stripTarget(target: ProjectSettingsWriteTargetOption): ProjectSettingsWriteTarget {
  if (target.type === 'project') return { type: 'project' };
  if (target.type === 'task') return { type: 'task', taskId: target.taskId };
  return { type: 'workspace', workspaceId: target.workspaceId };
}

export function stripResolvedTarget(
  target: ProjectSettingsResolvedTarget
): ProjectSettingsWriteTargetOption {
  const { configPath: _configPath, files: _files, ...option } = target;
  return option;
}

function targetKey(target: ProjectSettingsWriteTarget): string {
  if (target.type === 'project') return 'project';
  if (target.type === 'task') return `task:${target.taskId}`;
  return `workspace:${target.workspaceId}`;
}

type TaskTargetRow = {
  id: string;
  name: string;
  workspaceId: string | null;
  workspaceKind: 'worktree' | 'project-root' | 'byoi' | null;
  workspaceBranchName: string | null;
  workspaceConfig: WorkspaceConfig | null;
};

async function resolveTaskTarget(
  project: ProjectProvider,
  task: TaskTargetRow
): Promise<ProjectSettingsResolvedTarget | null> {
  let targetPath: string | null = null;
  let files: FilesClientScope | null = null;
  let configPath: string | null = null;

  if (task.workspaceId) {
    const activeWorkspace = workspaceRegistry.get(task.workspaceId);
    if (activeWorkspace) {
      targetPath = activeWorkspace.path;
      files = activeWorkspace.files;
      configPath = activeWorkspace.configPath;
    }
  }

  const provisionedBranch = getProvisionedWorkspaceBranch({
    kind: task.workspaceKind,
    branchName: task.workspaceBranchName,
    config: task.workspaceConfig,
  });
  if (!targetPath && provisionedBranch) {
    targetPath = (await project.worktreeService.findBranchAnywhere(provisionedBranch)) ?? null;
  }
  if (!targetPath) return null;
  if (targetPath === project.repoPath) return null;
  const resolvedFiles = files ?? project.files;

  return {
    type: 'task',
    taskId: task.id,
    label: task.name,
    path: targetPath,
    files: resolvedFiles,
    configPath: configPath ?? project.configPathForDirectory(targetPath),
  };
}

export async function resolveAllProjectSettingsTargets(
  project: ProjectProvider
): Promise<ProjectSettingsResolvedTarget[]> {
  const [projectRow] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(and(eq(projectsTable.id, project.projectId), isNull(projectsTable.deletedAt)))
    .limit(1);

  const projectTarget: ProjectSettingsResolvedTarget = {
    type: 'project',
    label: projectRow?.name ?? 'Project repository',
    path: project.repoPath,
    files: project.files,
    configPath: project.projectConfigPath,
  };
  if (!projectRow) return [projectTarget];

  const taskRows = await db
    .select({
      id: tasksTable.id,
      name: tasksTable.name,
      workspaceId: tasksTable.workspaceId,
      workspaceKind: workspacesTable.kind,
      workspaceBranchName: workspacesTable.branchName,
      workspaceConfig: workspacesTable.config,
    })
    .from(tasksTable)
    .leftJoin(
      workspacesTable,
      and(eq(tasksTable.workspaceId, workspacesTable.id), isNull(workspacesTable.deletedAt))
    )
    .where(and(eq(tasksTable.projectId, project.projectId), isNull(tasksTable.deletedAt)));

  const taskTargets = (
    await Promise.all(taskRows.map((task) => resolveTaskTarget(project, task)))
  ).filter((target): target is ProjectSettingsResolvedTarget => target !== null);

  return [projectTarget, ...taskTargets];
}

export function getProjectSettingsWriteTargets(
  targets: ProjectSettingsResolvedTarget[]
): ProjectSettingsWriteTargetOption[] {
  return targets.map(stripResolvedTarget);
}

export async function resolveProjectSettingsTarget(
  project: ProjectProvider,
  request: Pick<WriteProjectConfigRequest, 'target'>,
  resolvedTargets: ProjectSettingsResolvedTarget[]
): Promise<ProjectSettingsResolvedTarget | null> {
  const target = resolvedTargets.find(
    (candidate) => targetKey(stripTarget(candidate)) === targetKey(request.target)
  );
  if (target) return target;

  if (request.target.type === 'workspace') {
    const workspace = resolveWorkspace(project.projectId, request.target.workspaceId);
    if (!workspace) return null;
    return {
      type: 'workspace',
      workspaceId: request.target.workspaceId,
      label: 'Workspace',
      path: workspace.path,
      files: workspace.files,
      configPath: workspace.configPath,
    };
  }

  return null;
}
