import path from 'node:path';
import { promises as fs } from 'node:fs';
import { eq } from 'drizzle-orm';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { SshExecutionContext } from '@main/core/execution-context/ssh-execution-context';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { LocalWorktreeHost } from '@main/core/projects/worktrees/hosts/local-worktree-host';
import { SshWorktreeHost } from '@main/core/projects/worktrees/hosts/ssh-worktree-host';
import { WorktreeService } from '@main/core/projects/worktrees/worktree-service';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { db } from '@main/db/client';
import { projectRepoInstances } from '@main/db/schema';
import type { ProjectSettings } from '@shared/project-settings';
import type { UpdateProjectSettingsError } from '@shared/projects';
import { ok, type Result } from '@shared/result';
import type { ProjectSettingsPatch, ProjectSettingsProvider } from '../projects/settings/provider';
import type { WorkspaceType } from '../workspaces/workspace-factory';

export type InstanceResources = {
  type: WorkspaceType;
  worktreeService: WorktreeService;
  projectPath: string;
  connectionId?: string;
};

/**
 * Minimal settings provider for secondary repo instances.
 * Falls back to sensible defaults for all settings; preserved file patterns and
 * worktree directory customisation are not supported for secondary instances.
 */
class InstanceSettingsProvider implements ProjectSettingsProvider {
  constructor(private readonly repoPath: string) {}

  async getDefaultBranch(): Promise<string> {
    return 'main';
  }
  async getBaseRemote(): Promise<string> {
    return 'origin';
  }
  async getPushRemote(): Promise<string> {
    return 'origin';
  }
  async getDefaultWorktreeDirectory(): Promise<string> {
    return path.posix.join(path.posix.dirname(this.repoPath), '.emdash-worktrees');
  }
  async getWorktreeDirectory(): Promise<string> {
    return path.posix.join(path.posix.dirname(this.repoPath), '.emdash-worktrees');
  }
  async get(): Promise<ProjectSettings> {
    return {};
  }
  async update(_settings: ProjectSettings): Promise<Result<void, UpdateProjectSettingsError>> {
    return ok(undefined);
  }
  async patch(_patch: ProjectSettingsPatch): Promise<Result<void, UpdateProjectSettingsError>> {
    return ok(undefined);
  }
  ensure(): Promise<void> {
    return Promise.resolve();
  }
}

/**
 * Builds the runtime resources (WorkspaceType, WorktreeService, projectPath) needed
 * to provision a task against a secondary RepoInstance rather than the primary project.
 *
 * The worktree pool is placed as a sibling of the instance's repo:
 *   <instance.path>/../.emdash-worktrees/<repo-name>
 *
 * This mirrors the SSH project convention without requiring project settings.
 */
export async function buildInstanceResources(instanceId: string): Promise<InstanceResources> {
  const [row] = await db
    .select()
    .from(projectRepoInstances)
    .where(eq(projectRepoInstances.id, instanceId));

  if (!row) throw new Error(`RepoInstance not found: ${instanceId}`);
  if (!row.path) throw new Error(`RepoInstance ${instanceId} has no path`);

  const repoPath = row.path;
  const repoName = path.posix.basename(repoPath);
  const poolPath = path.posix.join(path.posix.dirname(repoPath), '.emdash-worktrees', repoName);

  const settings = new InstanceSettingsProvider(repoPath);

  if (row.kind === 'ssh') {
    if (!row.connectionId) throw new Error(`SSH RepoInstance ${instanceId} has no connectionId`);
    const proxy = await sshConnectionManager.connect(row.connectionId);

    const rootFs = new SshFileSystem(proxy, '/');
    const ctx = new SshExecutionContext(proxy, { root: repoPath });
    const host = new SshWorktreeHost(rootFs);
    await host.mkdirAbsolute(poolPath, { recursive: true });

    const worktreeService = new WorktreeService({
      repoPath,
      projectSettings: settings,
      ctx,
      host,
      resolveWorktreePoolPath: async () => poolPath,
    });

    return {
      type: { kind: 'ssh', proxy, connectionId: row.connectionId },
      worktreeService,
      projectPath: repoPath,
      connectionId: row.connectionId,
    };
  }

  // local
  const localPoolPath = path.join(path.dirname(repoPath), '.emdash-worktrees', repoName);
  await fs.mkdir(localPoolPath, { recursive: true });
  const ctx = new LocalExecutionContext({ root: repoPath });
  const host = await LocalWorktreeHost.create({ allowedRoots: [repoPath, localPoolPath] });

  const worktreeService = new WorktreeService({
    repoPath,
    projectSettings: settings,
    ctx,
    host,
    resolveWorktreePoolPath: async () => localPoolPath,
  });

  return {
    type: { kind: 'local' },
    worktreeService,
    projectPath: repoPath,
  };
}
