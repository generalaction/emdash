import { eq } from 'drizzle-orm';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { db } from '@main/db/client';
import { projects as projectsTable, tasks as tasksTable } from '@main/db/schema';
import type {
  ProjectSettingsWriteTarget,
  ProjectSettingsWriteTargetOption,
  WriteProjectConfigRequest,
} from '@shared/project-settings';
import type { ProjectProvider } from '../../project-provider';
import { resolveWorkspace } from '../../utils';

export type ProjectSettingsResolvedTarget = ProjectSettingsWriteTargetOption & {
  fs: FileSystemProvider;
};

function stripTarget(target: ProjectSettingsWriteTargetOption): ProjectSettingsWriteTarget {
  if (target.type === 'project') return { type: 'project' };
  if (target.type === 'task') return { type: 'task', taskId: target.taskId };
  return { type: 'workspace', workspaceId: target.workspaceId };
}

export function stripResolvedTarget(
  target: ProjectSettingsResolvedTarget
): ProjectSettingsWriteTargetOption {
  const { fs: _fs, ...option } = target;
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
  taskBranch: string | null;
  workspaceId: string | null;
};

async function resolveTaskTarget(
  project: ProjectProvider,
  task: TaskTargetRow
): Promise<ProjectSettingsResolvedTarget | null> {
  let targetPath: string | null = null;
  let fs: FileSystemProvider | null = null;

  if (task.workspaceId) {
    const activeWorkspace = workspaceRegistry.get(task.workspaceId);
    if (activeWorkspace) {
      targetPath = activeWorkspace.path;
      fs = activeWorkspace.fs;
    }
  }

  if (!targetPath && task.taskBranch) {
    targetPath = (await project.worktreeService.findBranchAnywhere(task.taskBranch)) ?? null;
  }
  if (!targetPath) return null;
  if (targetPath === project.repoPath) return null;

  return {
    type: 'task',
    taskId: task.id,
    label: task.name,
    path: targetPath,
    fs:
      fs ??
      (project.defaultWorkspaceType.kind === 'ssh'
        ? new SshFileSystem(project.defaultWorkspaceType.proxy, targetPath)
        : new LocalFileSystem(targetPath)),
  };
}

export async function resolveAllProjectSettingsTargets(
  project: ProjectProvider
): Promise<ProjectSettingsResolvedTarget[]> {
  const [projectRow] = await db
    .select({ name: projectsTable.name })
    .from(projectsTable)
    .where(eq(projectsTable.id, project.projectId))
    .limit(1);

  const projectTarget: ProjectSettingsResolvedTarget = {
    type: 'project',
    label: projectRow?.name ?? 'Project repository',
    path: project.repoPath,
    fs: project.fs,
  };
  if (!projectRow) return [projectTarget];

  const taskRows = await db
    .select({
      id: tasksTable.id,
      name: tasksTable.name,
      taskBranch: tasksTable.taskBranch,
      workspaceId: tasksTable.workspaceId,
    })
    .from(tasksTable)
    .where(eq(tasksTable.projectId, project.projectId));

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
    return workspace
      ? {
          type: 'workspace',
          workspaceId: request.target.workspaceId,
          label: 'Workspace',
          path: workspace.path,
          fs: workspace.fs,
        }
      : null;
  }

  return null;
}
