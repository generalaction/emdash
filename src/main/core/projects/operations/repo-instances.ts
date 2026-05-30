import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { cloneRepository, listWorktreesFromContext } from '@main/core/git/impl/git-repo-utils';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { db } from '@main/db/client';
import { projectRepoInstances } from '@main/db/schema';
import type {
  AddRepoInstanceParams,
  RemoveRepoInstanceResult,
  RepoInstance,
} from '@shared/projects';
import type { WorktreeEntry } from '@shared/workspaces';
import { getLocalProjectPathStatus } from './create-local-project';
import { getSshProjectPathStatus } from './create-ssh-project';

function rowToRepoInstance(row: typeof projectRepoInstances.$inferSelect): RepoInstance {
  return {
    id: row.id,
    projectId: row.projectId,
    label: row.label,
    kind: row.kind,
    connectionId: row.connectionId,
    path: row.path,
    remoteUrl: row.remoteUrl,
    isFork: Boolean(row.isFork),
    isPrimary: Boolean(row.isPrimary),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function listRepoInstances(projectId: string): Promise<RepoInstance[]> {
  const rows = await db
    .select()
    .from(projectRepoInstances)
    .where(eq(projectRepoInstances.projectId, projectId))
    .orderBy(projectRepoInstances.createdAt);
  return rows.map(rowToRepoInstance);
}

async function cloneToPath(params: AddRepoInstanceParams): Promise<void> {
  if (!params.cloneUrl || !params.path) return;

  if (params.kind === 'ssh') {
    if (!params.connectionId) throw new Error('Connection ID is required for SSH cloning');
    const proxy = await sshConnectionManager.connect(params.connectionId);
    const parentPath = path.posix.dirname(params.path);
    const parentFs = new SshFileSystem(proxy, parentPath);
    await parentFs.mkdir('.', { recursive: true });
    const ctx = new SshExecutionContext(proxy, { root: parentPath });
    const result = await cloneRepository(params.cloneUrl, params.path, ctx);
    if (!result.success) throw new Error(result.error ?? 'Clone failed');
  } else {
    const parentPath = path.dirname(params.path);
    const parentFs = new LocalFileSystem(parentPath);
    await parentFs.mkdir('.', { recursive: true });
    const ctx = new LocalExecutionContext({ root: parentPath });
    const result = await cloneRepository(params.cloneUrl, params.path, ctx);
    if (!result.success) throw new Error(result.error ?? 'Clone failed');
  }
}

export async function addRepoInstance(params: AddRepoInstanceParams): Promise<RepoInstance> {
  if (params.kind === 'local') {
    if (!params.path) throw new Error('Path is required for local repo instances');
    if (params.cloneUrl) {
      await cloneToPath(params);
    } else {
      const status = await getLocalProjectPathStatus(params.path);
      if (!status.isDirectory) throw new Error('Path is not a valid directory');
      if (!status.isGitRepo) throw new Error('Path is not a git repository');
    }
  } else if (params.kind === 'ssh') {
    if (!params.path) throw new Error('Path is required for SSH repo instances');
    if (!params.connectionId) throw new Error('Connection ID is required for SSH repo instances');
    if (params.cloneUrl) {
      await cloneToPath(params);
    } else {
      const status = await getSshProjectPathStatus(params.path, params.connectionId);
      if (!status.isDirectory) throw new Error('Remote path is not a valid directory');
      if (!status.isGitRepo) throw new Error('Remote path is not a git repository');
    }
  }
  // byoi: no path validation needed

  const [row] = await db
    .insert(projectRepoInstances)
    .values({
      id: randomUUID(),
      projectId: params.projectId,
      label: params.label ?? null,
      kind: params.kind,
      connectionId: params.connectionId ?? null,
      path: params.path ?? null,
      remoteUrl: params.remoteUrl ?? null,
      isFork: params.isFork ? 1 : 0,
      isPrimary: 0,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    })
    .returning();

  if (!row) throw new Error('Failed to insert repo instance');
  return rowToRepoInstance(row);
}

export async function listWorktreesForInstance(
  projectId: string,
  instanceId: string
): Promise<WorktreeEntry[]> {
  const [row] = await db
    .select()
    .from(projectRepoInstances)
    .where(
      and(eq(projectRepoInstances.id, instanceId), eq(projectRepoInstances.projectId, projectId))
    );

  if (!row || !row.path) return [];
  if (row.kind === 'byoi') return [];

  if (row.kind === 'ssh') {
    if (!row.connectionId) return [];
    const proxy = await sshConnectionManager.connect(row.connectionId);
    const ctx = new SshExecutionContext(proxy, { root: row.path });
    return listWorktreesFromContext(ctx, row.path);
  }

  const ctx = new LocalExecutionContext({ root: row.path });
  return listWorktreesFromContext(ctx, row.path);
}

export async function removeRepoInstance(
  projectId: string,
  instanceId: string
): Promise<RemoveRepoInstanceResult> {
  const existing = await db
    .select()
    .from(projectRepoInstances)
    .where(
      and(eq(projectRepoInstances.id, instanceId), eq(projectRepoInstances.projectId, projectId))
    );

  if (existing.length === 0) {
    return { success: false, error: 'Repo instance not found' };
  }

  if (existing[0]?.isPrimary) {
    return { success: false, error: 'Cannot remove the primary repo instance' };
  }

  await db
    .delete(projectRepoInstances)
    .where(
      and(eq(projectRepoInstances.id, instanceId), eq(projectRepoInstances.projectId, projectId))
    );

  return { success: true };
}
