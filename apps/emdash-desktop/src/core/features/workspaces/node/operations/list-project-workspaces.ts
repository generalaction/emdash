import { hostRefFromParts, type HostRef } from '@emdash/core/primitives/host/api';
import { parseAbsolute } from '@emdash/core/primitives/path/api';
import {
  runtimeResolveErrorAsError,
  type RuntimeBroker,
} from '@emdash/core/services/runtime-broker/api';
import { and, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm';
import type { TaskSessionManager } from '@core/features/tasks/api/node/task-session-manager';
import {
  createWorkspaceRegistry,
  isAnnotatedWorkspace,
  liveWorkspaces,
  workspaceRegistryTable as workspaces,
} from '@core/features/workspaces/api/node/registry';
import { getProvisionedWorkspaceBranch } from '@core/features/workspaces/api/node/workspace-branch';
import type { TaskLifecycleStatus } from '@core/primitives/tasks/api';
import type {
  ProjectWorkspaceRow,
  ProjectWorkspaceTask,
  ProjectWorkspacesResult,
} from '@core/primitives/workspaces/api';
import type { WorkspaceConfig } from '@core/primitives/workspaces/api';
import type { AppDb } from '@core/services/app-db/node/db';
import { projects, tasks } from '@core/services/app-db/node/schema';
import { applyRepoSnapshot } from '../sync/apply-repo-snapshot';

export type ProjectWorkspaceProjectRow = {
  id: string;
  path: string;
  workspaceProvider: string;
  sshConnectionId: string | null;
  repositoryWorkspaceId: string | null;
  repositoryWorkspaceLocation: 'local' | 'remote' | null;
  repositoryWorkspaceSshConnectionId: string | null;
};

export type ListProjectWorkspacesDependencies = {
  db: AppDb;
  runtimes: Pick<RuntimeBroker, 'client'>;
  taskSessions: Pick<TaskSessionManager, 'getTask'>;
};

type WorkspaceRow = {
  id: string;
  type: 'local' | 'project-ssh' | 'byoi';
  kind: 'worktree' | 'project-root' | 'byoi' | null;
  location: 'local' | 'remote' | null;
  sshConnectionId: string | null;
  path: string | null;
  branchName: string | null;
  config: WorkspaceConfig | null;
  observedStatus: 'present' | 'missing' | 'corrupted' | null;
  observedGitBranch: string | null;
  observedData: { corruptionReason?: string } | null;
  lastObservedAt: string | null;
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
  prunableReason?: string;
  workspace: WorkspaceRow | undefined;
  tasks: ProjectWorkspaceTask[];
};

export async function listProjectWorkspaces(
  dependencies: ListProjectWorkspacesDependencies,
  projectId: string
): Promise<ProjectWorkspacesResult> {
  const project = await getProjectWorkspaceProject(dependencies.db, projectId);
  const projectHost = projectWorkspaceHost(project);
  const taskRows = await getTaskRows(dependencies.db, projectId);
  const scan = await scanAndApplyRepositorySnapshot(dependencies, project);
  const warnings = scan.warning ? [scan.warning] : [];
  const workspaceRows = await getWorkspaceRows(
    dependencies.db,
    project.repositoryWorkspaceId,
    taskRows.flatMap((row) => (row.workspaceId ? [row.workspaceId] : []))
  );

  const workspacesById = new Map(workspaceRows.map((workspace) => [workspace.id, workspace]));
  const tasksByWorkspaceId = groupTasks(taskRows);
  const candidates: RowCandidate[] = [];

  for (const workspace of workspaceRows) {
    if (!workspace.path) continue;
    const rowTasks = tasksByWorkspaceId.get(workspace.id) ?? [];
    const isMain = workspace.id === project.repositoryWorkspaceId;
    candidates.push({
      kind: isMain
        ? 'root'
        : isAnnotatedWorkspace({ config: workspace.config, hasTaskLink: rowTasks.length > 0 })
          ? 'workspace'
          : 'candidate',
      path: workspace.path,
      branch: workspace.observedGitBranch ?? workspaceBranch(workspace),
      isMain,
      prunable: workspace.observedStatus === 'corrupted',
      ...(workspace.observedData?.corruptionReason
        ? { prunableReason: workspace.observedData.corruptionReason }
        : {}),
      workspace,
      tasks: rowTasks,
    });
  }

  if (!candidates.some((candidate) => candidate.isMain)) {
    const rootWorkspace = project.repositoryWorkspaceId
      ? workspacesById.get(project.repositoryWorkspaceId)
      : undefined;
    candidates.push({
      kind: 'root',
      path: project.path,
      branch: workspaceBranch(rootWorkspace),
      isMain: true,
      prunable: false,
      workspace: rootWorkspace,
      tasks: rootWorkspace ? (tasksByWorkspaceId.get(rootWorkspace.id) ?? []) : [],
    });
  }

  const rows = candidates.map((candidate) =>
    buildCandidateRow({ taskSessions: dependencies.taskSessions }, project, projectHost, candidate)
  );

  rows.sort((left, right) => {
    if (left.kind === 'root') return -1;
    if (right.kind === 'root') return 1;
    return left.path.localeCompare(right.path);
  });

  return {
    scannedAt: scan.scannedAt,
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

function buildCandidateRow(
  dependencies: Pick<ListProjectWorkspacesDependencies, 'taskSessions'>,
  project: ProjectWorkspaceProjectRow,
  projectHost: HostRef,
  candidate: RowCandidate
): ProjectWorkspaceRow {
  const projectIsLocal = project.workspaceProvider !== 'ssh';
  const remote =
    !projectIsLocal || candidate.workspace?.location === 'remote' || projectHost.type === 'remote';
  const byoi = candidate.workspace?.type === 'byoi' || candidate.workspace?.kind === 'byoi';
  const hasActiveSessions = candidate.tasks.some(
    (task) => !!dependencies.taskSessions.getTask(task.taskId)
  );
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
    observedStatus: candidate.workspace?.observedStatus ?? undefined,
    lastObservedAt: candidate.workspace?.lastObservedAt ?? undefined,
    errors: [],
  };

  const observedMissing = candidate.workspace?.observedStatus === 'missing';
  const observedCorrupted = candidate.workspace?.observedStatus === 'corrupted';
  if (candidate.prunable || observedMissing || observedCorrupted) {
    return {
      ...base,
      pathState: 'missing',
      pathIssue: {
        kind: candidate.prunable || observedCorrupted ? 'prunable' : 'path-gone',
        ...(candidate.prunableReason
          ? { reason: candidate.prunableReason }
          : observedCorrupted
            ? { reason: 'Host inventory reported this worktree as corrupted.' }
            : {}),
      },
      canDelete: candidate.kind !== 'root' && !remote && !byoi,
    };
  }

  return {
    ...base,
    pathState: 'measured',
    canCleanArtifacts: !remote && !byoi,
  };
}

export async function getProjectWorkspaceProject(
  db: AppDb,
  projectId: string
): Promise<ProjectWorkspaceProjectRow> {
  const [project] = await db
    .select({
      id: projects.id,
      path: projects.path,
      workspaceProvider: projects.workspaceProvider,
      sshConnectionId: projects.sshConnectionId,
      repositoryWorkspaceId: projects.repositoryWorkspaceId,
    })
    .from(projects)
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  if (!project) throw new Error('Project was not found.');
  const repositoryWorkspace =
    project.repositoryWorkspaceId !== null
      ? await getRepositoryWorkspaceHostRow(db, project.repositoryWorkspaceId)
      : null;
  return {
    ...project,
    repositoryWorkspaceLocation: repositoryWorkspace?.location ?? null,
    repositoryWorkspaceSshConnectionId: repositoryWorkspace?.sshConnectionId ?? null,
  };
}

async function getRepositoryWorkspaceHostRow(
  db: AppDb,
  workspaceId: string
): Promise<{ location: 'local' | 'remote' | null; sshConnectionId: string | null } | null> {
  const workspace = createWorkspaceRegistry(db).getLive(workspaceId);
  return workspace ?? null;
}

async function getWorkspaceRows(
  db: AppDb,
  repositoryWorkspaceId: string | null,
  taskWorkspaceIds: readonly string[]
): Promise<WorkspaceRow[]> {
  const scope = repositoryWorkspaceId
    ? or(
        eq(workspaces.id, repositoryWorkspaceId),
        eq(workspaces.parentId, repositoryWorkspaceId),
        taskWorkspaceIds.length > 0 ? inArray(workspaces.id, [...taskWorkspaceIds]) : undefined
      )
    : taskWorkspaceIds.length > 0
      ? inArray(workspaces.id, [...taskWorkspaceIds])
      : undefined;
  if (!scope) return [];
  return (await db
    .select({
      id: workspaces.id,
      type: workspaces.type,
      kind: workspaces.kind,
      location: workspaces.location,
      sshConnectionId: workspaces.sshConnectionId,
      path: workspaces.path,
      branchName: workspaces.branchName,
      config: workspaces.config,
      observedStatus: workspaces.observedStatus,
      observedGitBranch: workspaces.observedGitBranch,
      observedData: workspaces.observedData,
      lastObservedAt: workspaces.lastObservedAt,
    })
    .from(workspaces)
    .where(and(scope, isNotNull(workspaces.path), liveWorkspaces()))) as WorkspaceRow[];
}

async function getTaskRows(db: AppDb, projectId: string): Promise<TaskRow[]> {
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
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)));
}

async function scanAndApplyRepositorySnapshot(
  dependencies: Pick<ListProjectWorkspacesDependencies, 'db' | 'runtimes'>,
  project: ProjectWorkspaceProjectRow
): Promise<{ scannedAt: string; warning?: string }> {
  try {
    if (!project.repositoryWorkspaceId) throw new Error('Project has no repository workspace.');
    const repository = createWorkspaceRegistry(dependencies.db).getLive(
      project.repositoryWorkspaceId
    );
    if (!repository?.path) throw new Error('Repository workspace has no path.');
    const repoRoot = parseAbsolute(repository.path);
    if (!repoRoot.success) throw new Error(`Repository path is not absolute: ${repository.path}`);
    const runtime = await dependencies.runtimes.client(projectWorkspaceHost(project));
    if (!runtime.success) throw runtimeResolveErrorAsError(runtime.error);
    const result = await runtime.data.workspaceHost.snapshotRepository({
      repoRoot: repoRoot.data,
      tier: 'presence',
    });
    if (!result.success) throw new Error(result.error.message);
    await applyRepoSnapshot({
      db: dependencies.db,
      repository,
      snapshot: result.data,
      projectId: project.id,
    });
    return { scannedAt: new Date(result.data.scannedAt).toISOString() };
  } catch (error) {
    return {
      scannedAt: new Date().toISOString(),
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

function latest(values: Array<string | undefined>): string | undefined {
  return values
    .filter((value): value is string => !!value)
    .sort()
    .at(-1);
}

export function projectWorkspaceHost(project: ProjectWorkspaceProjectRow): HostRef {
  return hostRefFromParts(
    project.repositoryWorkspaceLocation,
    project.repositoryWorkspaceSshConnectionId
  );
}
