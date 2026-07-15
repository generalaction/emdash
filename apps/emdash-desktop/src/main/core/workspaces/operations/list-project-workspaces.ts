import { access } from 'node:fs/promises';
import path from 'node:path';
import { eq, isNotNull } from 'drizzle-orm';
import type { GitWorktreesState } from '@emdash/core/runtimes/git/api';
import { repositorySelector, gitErrorMessage } from '@main/core/git/runtime-client';
import { taskSessionManager } from '@main/core/tasks/task-session-manager';
import { getGitRuntimeClient } from '@main/core/wire-workers/accessors';
import { getProvisionedWorkspaceBranch } from '@main/core/workspaces/workspace-branch';
import { db } from '@main/db/client';
import { projects, tasks, workspaces } from '@main/db/schema';
import { nativePathFromHost } from '@shared/core/runtime/paths';
import type {
  ProjectWorkspaceRow,
  ProjectWorkspaceTask,
  ProjectWorkspacesResult,
} from '@shared/core/workspaces/project-workspaces';
import type { WorkspaceConfig } from '@shared/core/workspaces/workspace-config';
import type { TaskLifecycleStatus } from '@shared/core/tasks/tasks';

const MEASURE_CONCURRENCY = 4;

export type ProjectWorkspaceProjectRow = {
  id: string;
  path: string;
  workspaceProvider: string;
  repositoryWorkspaceId: string | null;
};

type WorkspaceRow = {
  id: string;
  type: 'local' | 'project-ssh' | 'byoi';
  kind: 'worktree' | 'project-root' | 'byoi' | null;
  location: 'local' | 'remote' | null;
  path: string | null;
  branchName: string | null;
  config: WorkspaceConfig | null;
};

type TaskRow = {
  taskId: string;
  name: string;
  status: string;
  archivedAt: string | null;
  updatedAt: string;
  lastInteractedAt: string | null;
  workspaceId: string | null;
};

type RowCandidate = {
  kind: ProjectWorkspaceRow['kind'];
  path: string;
  branch?: string;
  isMain: boolean;
  prunable: boolean;
  workspace: WorkspaceRow | undefined;
  tasks: ProjectWorkspaceTask[];
};

export async function listProjectWorkspaces(projectId: string): Promise<ProjectWorkspacesResult> {
  const project = await getProjectWorkspaceProject(projectId);
  const [workspaceRows, taskRows, worktreesResult] = await Promise.all([
    getWorkspaceRows(),
    getTaskRows(projectId),
    listGitWorktreesSafe(project),
  ]);
  const worktreeEntries = worktreesResult.worktrees;
  const warnings = worktreesResult.warning ? [worktreesResult.warning] : [];

  const workspacesById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]));
  const workspacesByPath = new Map(
    workspaceRows
      .filter((workspace): workspace is WorkspaceRow & { path: string } => !!workspace.path)
      .map((workspace) => [pathKey(workspace.path), workspace])
  );
  const tasksByWorkspaceId = groupTasks(taskRows);
  const candidates = new Map<string, RowCandidate>();

  for (const worktree of worktreeEntries) {
    const nativePath = nativePathFromHost(worktree.worktreePath);
    const workspace = workspacesByPath.get(pathKey(nativePath));
    const branch = worktree.head.kind === 'branch' ? worktree.head.name : undefined;
    candidates.set(pathKey(nativePath), {
      kind: worktree.isMain ? 'root' : workspace ? 'workspace' : 'candidate',
      path: nativePath,
      branch: branch ?? workspaceBranch(workspace),
      isMain: worktree.isMain,
      prunable: worktree.prunable ?? false,
      workspace,
      tasks: workspace ? (tasksByWorkspaceId.get(workspace.id) ?? []) : [],
    });
  }

  for (const taskRow of taskRows) {
    const workspace = taskRow.workspaceId ? workspacesById.get(taskRow.workspaceId) : undefined;
    if (!workspace?.path) continue;
    const key = pathKey(workspace.path);
    if (candidates.has(key)) continue;
    candidates.set(key, {
      kind: workspace.id === project.repositoryWorkspaceId ? 'root' : 'workspace',
      path: workspace.path,
      branch: workspaceBranch(workspace),
      isMain: workspace.id === project.repositoryWorkspaceId,
      prunable: false,
      workspace,
      tasks: tasksByWorkspaceId.get(workspace.id) ?? [],
    });
  }

  const rootKey = pathKey(project.path);
  if (!candidates.has(rootKey)) {
    const rootWorkspace = project.repositoryWorkspaceId
      ? workspacesById.get(project.repositoryWorkspaceId)
      : workspacesByPath.get(rootKey);
    candidates.set(rootKey, {
      kind: 'root',
      path: project.path,
      branch: workspaceBranch(rootWorkspace),
      isMain: true,
      prunable: false,
      workspace: rootWorkspace,
      tasks: rootWorkspace ? (tasksByWorkspaceId.get(rootWorkspace.id) ?? []) : [],
    });
  }

  const rows = await mapWithConcurrency(
    Array.from(candidates.values()),
    MEASURE_CONCURRENCY,
    (candidate) => buildCandidateRow(project, candidate)
  );

  rows.sort((left, right) => {
    if (left.kind === 'root') return -1;
    if (right.kind === 'root') return 1;
    return left.path.localeCompare(right.path);
  });

  return {
    scannedAt: new Date().toISOString(),
    projectId,
    rows,
    totalBytes: rows.reduce((sum, row) => sum + (row.usage?.totalBytes ?? 0), 0),
    artifactBytes: rows.reduce((sum, row) => sum + (row.usage?.artifactBytes ?? 0), 0),
    warnings,
  };
}

export async function mapWithConcurrency<T, U>(
  items: readonly T[],
  limit: number,
  mapItem: (item: T) => Promise<U>
): Promise<U[]> {
  const results = new Array<U>(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapItem(items[index]!);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

async function buildCandidateRow(
  project: ProjectWorkspaceProjectRow,
  candidate: RowCandidate
): Promise<ProjectWorkspaceRow> {
  const projectIsLocal = project.workspaceProvider !== 'ssh';
  const remote = !projectIsLocal || candidate.workspace?.location === 'remote';
  const byoi = candidate.workspace?.type === 'byoi' || candidate.workspace?.kind === 'byoi';
  const exists = await pathExists(candidate.path);
  const hasActiveSessions = candidate.tasks.some((task) => !!taskSessionManager.getTask(task.taskId));
  const lastActivityAt = latest(
    candidate.tasks.flatMap((task) => [task.lastInteractedAt, task.updatedAt])
  );

  const base: ProjectWorkspaceRow = {
    kind: candidate.kind,
    projectId: project.id,
    workspaceId: candidate.workspace?.id ?? null,
    path: candidate.path,
    branch: candidate.branch,
    tasks: candidate.tasks,
    usage: null,
    pathState: 'no-path',
    canCleanArtifacts: false,
    canDelete: candidate.kind !== 'root' && !remote && !byoi,
    hasActiveSessions,
    lastActivityAt,
    errors: [],
  };

  if (remote) return { ...base, pathState: 'remote', canDelete: false };
  if (!exists || candidate.prunable) {
    return {
      ...base,
      pathState: 'missing',
      canDelete: candidate.kind !== 'root' && !byoi,
    };
  }

  return {
    ...base,
    pathState: 'measured',
    canCleanArtifacts: !byoi,
  };
}

export async function getProjectWorkspaceProject(
  projectId: string
): Promise<ProjectWorkspaceProjectRow> {
  const [project] = await db
    .select({
      id: projects.id,
      path: projects.path,
      workspaceProvider: projects.workspaceProvider,
      repositoryWorkspaceId: projects.repositoryWorkspaceId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new Error('Project was not found.');
  return project;
}

async function getWorkspaceRows(): Promise<WorkspaceRow[]> {
  return (await db
    .select({
      id: workspaces.id,
      type: workspaces.type,
      kind: workspaces.kind,
      location: workspaces.location,
      path: workspaces.path,
      branchName: workspaces.branchName,
      config: workspaces.config,
    })
    .from(workspaces)
    .where(isNotNull(workspaces.path))) as WorkspaceRow[];
}

async function getTaskRows(projectId: string): Promise<TaskRow[]> {
  return await db
    .select({
      taskId: tasks.id,
      name: tasks.name,
      status: tasks.status,
      archivedAt: tasks.archivedAt,
      updatedAt: tasks.updatedAt,
      lastInteractedAt: tasks.lastInteractedAt,
      workspaceId: tasks.workspaceId,
    })
    .from(tasks)
    .where(eq(tasks.projectId, projectId));
}

async function listGitWorktrees(project: ProjectWorkspaceProjectRow): Promise<GitWorktreesState> {
  if (project.workspaceProvider === 'ssh') return [];
  const git = await getGitRuntimeClient();
  const result = await git.repository.listWorktrees(repositorySelector(project.path));
  if (!result.success) throw new Error(gitErrorMessage(result.error));
  return result.data;
}

async function listGitWorktreesSafe(
  project: ProjectWorkspaceProjectRow
): Promise<{ worktrees: GitWorktreesState; warning?: string }> {
  try {
    return { worktrees: await listGitWorktrees(project) };
  } catch (error) {
    return {
      worktrees: [],
      warning: `Could not scan git worktrees: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function groupTasks(rows: TaskRow[]): Map<string, ProjectWorkspaceTask[]> {
  const grouped = new Map<string, ProjectWorkspaceTask[]>();
  for (const row of rows) {
    if (!row.workspaceId) continue;
    const list = grouped.get(row.workspaceId) ?? [];
    list.push({
      taskId: row.taskId,
      name: row.name,
      status: row.status as TaskLifecycleStatus,
      archivedAt: row.archivedAt ?? undefined,
      updatedAt: row.updatedAt,
      lastInteractedAt: row.lastInteractedAt ?? undefined,
    });
    grouped.set(row.workspaceId, list);
  }
  return grouped;
}

function workspaceBranch(workspace: WorkspaceRow | undefined): string | undefined {
  if (!workspace) return undefined;
  return (
    getProvisionedWorkspaceBranch({
      kind: workspace.kind,
      branchName: workspace.branchName,
      config: workspace.config,
    }) ?? undefined
  );
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function latest(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => !!value).sort().at(-1);
}

function pathKey(value: string): string {
  return path.resolve(value);
}
