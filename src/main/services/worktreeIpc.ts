import { ipcMain } from 'electron';
import { worktreeService } from './WorktreeService';
import { worktreePoolService } from './WorktreePoolService';
import { databaseService, type Project } from './DatabaseService';
import { getDrizzleClient } from '../db/drizzleClient';
import { projects as projectsTable } from '../db/schema';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';
import { RemoteGitService } from './RemoteGitService';
import { sshService } from './ssh/SshService';
import { log } from '../lib/logger';
import { quoteShellArg } from '../utils/shellEscape';

const remoteGitService = new RemoteGitService(sshService);

function stableIdFromRemotePath(worktreePath: string): string {
  const h = crypto.createHash('sha1').update(worktreePath).digest('hex').slice(0, 12);
  return `wt-${h}`;
}

async function resolveProjectByIdOrPath(args: {
  projectId?: string;
  projectPath?: string;
}): Promise<Project | null> {
  if (args.projectId) {
    return databaseService.getProjectById(args.projectId);
  }
  if (args.projectPath) {
    const { db } = await getDrizzleClient();
    const rows = await db
      .select({ id: projectsTable.id })
      .from(projectsTable)
      .where(eq(projectsTable.path, args.projectPath))
      .limit(1);
    if (rows.length > 0) {
      return databaseService.getProjectById(rows[0].id);
    }
  }
  return null;
}

function isRemoteProject(
  project: Project | null
): project is Project & { sshConnectionId: string; remotePath: string } {
  return !!(
    project &&
    project.isRemote &&
    typeof project.sshConnectionId === 'string' &&
    project.sshConnectionId.length > 0 &&
    typeof project.remotePath === 'string' &&
    project.remotePath.length > 0
  );
}

async function resolveRemoteProjectForWorktreePath(
  worktreePath: string
): Promise<(Project & { sshConnectionId: string; remotePath: string }) | null> {
  const all = await databaseService.getProjects();
  // Pick the longest matching remotePath prefix.
  const candidates = all
    .filter((p) => isRemoteProject(p))
    .filter((p) => worktreePath.startsWith(p.remotePath.replace(/\/+$/g, '') + '/'))
    .sort((a, b) => b.remotePath.length - a.remotePath.length);
  return candidates[0] ?? null;
}

export function registerWorktreeIpc(): void {
  // Create a new worktree
  ipcMain.handle(
    'worktree:create',
    async (
      event,
      args: {
        projectPath: string;
        taskName: string;
        projectId: string;
        baseRef?: string;
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({
          projectId: args.projectId,
          projectPath: args.projectPath,
        });

        if (isRemoteProject(project)) {
          const baseRef = args.baseRef ?? project.gitInfo.baseRef;
          log.info('worktree:create (remote)', {
            projectId: project.id,
            remotePath: project.remotePath,
          });
          const remote = await remoteGitService.createWorktree(
            project.sshConnectionId,
            project.remotePath,
            args.taskName,
            baseRef
          );
          const worktree = {
            id: stableIdFromRemotePath(remote.path),
            name: args.taskName,
            branch: remote.branch,
            path: remote.path,
            projectId: project.id,
            status: 'active' as const,
            createdAt: new Date().toISOString(),
          };
          return { success: true, worktree };
        }

        const worktree = await worktreeService.createWorktree(
          args.projectPath,
          args.taskName,
          args.projectId,
          args.baseRef
        );
        return { success: true, worktree };
      } catch (error) {
        console.error('Failed to create worktree:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // List worktrees for a project
  ipcMain.handle('worktree:list', async (event, args: { projectPath: string }) => {
    try {
      const project = await resolveProjectByIdOrPath({ projectPath: args.projectPath });
      if (isRemoteProject(project)) {
        const remoteWorktrees = await remoteGitService.listWorktrees(
          project.sshConnectionId,
          project.remotePath
        );
        const worktrees = remoteWorktrees.map((wt) => {
          const name = wt.path.split('/').filter(Boolean).pop() || wt.path;
          return {
            id: stableIdFromRemotePath(wt.path),
            name,
            branch: wt.branch,
            path: wt.path,
            projectId: project.id,
            status: 'active' as const,
            createdAt: new Date().toISOString(),
          };
        });
        return { success: true, worktrees };
      }

      const worktrees = await worktreeService.listWorktrees(args.projectPath);
      return { success: true, worktrees };
    } catch (error) {
      console.error('Failed to list worktrees:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Remove a worktree
  ipcMain.handle(
    'worktree:remove',
    async (
      event,
      args: {
        projectPath: string;
        worktreeId: string;
        worktreePath?: string;
        branch?: string;
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({ projectPath: args.projectPath });
        if (isRemoteProject(project)) {
          const pathToRemove = args.worktreePath;
          if (!pathToRemove) {
            throw new Error('worktreePath is required for remote worktree removal');
          }
          log.info('worktree:remove (remote)', {
            projectId: project.id,
            remotePath: project.remotePath,
            worktreePath: pathToRemove,
          });
          await remoteGitService.removeWorktree(
            project.sshConnectionId,
            project.remotePath,
            pathToRemove
          );
          // Best-effort prune to clear stale metadata.
          try {
            await sshService.executeCommand(
              project.sshConnectionId,
              'git worktree prune --verbose',
              project.remotePath
            );
          } catch {}
          if (args.branch) {
            try {
              await sshService.executeCommand(
                project.sshConnectionId,
                `git branch -D ${quoteShellArg(args.branch)}`,
                project.remotePath
              );
            } catch {}
          }
          return { success: true };
        }

        await worktreeService.removeWorktree(
          args.projectPath,
          args.worktreeId,
          args.worktreePath,
          args.branch
        );
        return { success: true };
      } catch (error) {
        console.error('Failed to remove worktree:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get worktree status
  ipcMain.handle('worktree:status', async (event, args: { worktreePath: string }) => {
    try {
      const remoteProject = await resolveRemoteProjectForWorktreePath(args.worktreePath);
      if (remoteProject) {
        const status = await remoteGitService.getWorktreeStatus(
          remoteProject.sshConnectionId,
          args.worktreePath
        );
        return { success: true, status };
      }

      const status = await worktreeService.getWorktreeStatus(args.worktreePath);
      return { success: true, status };
    } catch (error) {
      console.error('Failed to get worktree status:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Merge worktree changes
  ipcMain.handle(
    'worktree:merge',
    async (
      event,
      args: {
        projectPath: string;
        worktreeId: string;
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({ projectPath: args.projectPath });
        if (isRemoteProject(project)) {
          return { success: false, error: 'Remote worktree merge is not supported yet' };
        }
        await worktreeService.mergeWorktreeChanges(args.projectPath, args.worktreeId);
        return { success: true };
      } catch (error) {
        console.error('Failed to merge worktree changes:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Get worktree by ID
  ipcMain.handle('worktree:get', async (event, args: { worktreeId: string }) => {
    try {
      const worktree = worktreeService.getWorktree(args.worktreeId);
      return { success: true, worktree };
    } catch (error) {
      console.error('Failed to get worktree:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Get all worktrees
  ipcMain.handle('worktree:getAll', async () => {
    try {
      const worktrees = worktreeService.getAllWorktrees();
      return { success: true, worktrees };
    } catch (error) {
      console.error('Failed to get all worktrees:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Ensure a reserve worktree exists for a project (background operation)
  ipcMain.handle(
    'worktree:ensureReserve',
    async (
      event,
      args: {
        projectId: string;
        projectPath: string;
        baseRef?: string;
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({
          projectId: args.projectId,
          projectPath: args.projectPath,
        });
        if (isRemoteProject(project)) {
          // Remote worktree pooling is not supported (avoid local mkdir on remote paths).
          return { success: true };
        }
        // Fire and forget - don't await, just start the process
        worktreePoolService.ensureReserve(args.projectId, args.projectPath, args.baseRef);
        return { success: true };
      } catch (error) {
        console.error('Failed to ensure reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Check if a reserve is available for a project
  ipcMain.handle('worktree:hasReserve', async (event, args: { projectId: string }) => {
    try {
      const project = await resolveProjectByIdOrPath({ projectId: args.projectId });
      if (isRemoteProject(project)) {
        return { success: true, hasReserve: false };
      }
      const hasReserve = worktreePoolService.hasReserve(args.projectId);
      return { success: true, hasReserve };
    } catch (error) {
      console.error('Failed to check reserve:', error);
      return { success: false, error: (error as Error).message };
    }
  });

  // Claim a reserve worktree for a new task (instant operation)
  ipcMain.handle(
    'worktree:claimReserve',
    async (
      event,
      args: {
        projectId: string;
        projectPath: string;
        taskName: string;
        baseRef?: string;
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({
          projectId: args.projectId,
          projectPath: args.projectPath,
        });
        if (isRemoteProject(project)) {
          return { success: false, error: 'Remote worktree pooling is not supported yet' };
        }
        const result = await worktreePoolService.claimReserve(
          args.projectId,
          args.projectPath,
          args.taskName,
          args.baseRef
        );
        if (result) {
          return {
            success: true,
            worktree: result.worktree,
            needsBaseRefSwitch: result.needsBaseRefSwitch,
          };
        }
        return { success: false, error: 'No reserve available' };
      } catch (error) {
        console.error('Failed to claim reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Claim a reserve and persist the task in one IPC round-trip.
  ipcMain.handle(
    'worktree:claimReserveAndSaveTask',
    async (
      event,
      args: {
        projectId: string;
        projectPath: string;
        taskName: string;
        baseRef?: string;
        task: {
          projectId: string;
          name: string;
          status: 'active' | 'idle' | 'running';
          agentId?: string | null;
          metadata?: any;
          useWorktree?: boolean;
        };
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({
          projectId: args.projectId,
          projectPath: args.projectPath,
        });
        if (isRemoteProject(project)) {
          return { success: false, error: 'Remote worktree pooling is not supported yet' };
        }

        const claim = await worktreePoolService.claimReserve(
          args.projectId,
          args.projectPath,
          args.taskName,
          args.baseRef
        );
        if (!claim) {
          return { success: false, error: 'No reserve available' };
        }

        const persistedTask = {
          id: claim.worktree.id,
          projectId: args.projectId,
          name: args.taskName,
          branch: claim.worktree.branch,
          path: claim.worktree.path,
          status: args.task.status,
          agentId: args.task.agentId ?? null,
          metadata: args.task.metadata ?? null,
          useWorktree: args.task.useWorktree !== false,
        };

        await databaseService.saveTask(persistedTask);

        return {
          success: true,
          worktree: claim.worktree,
          task: persistedTask,
          needsBaseRefSwitch: claim.needsBaseRefSwitch,
        };
      } catch (error) {
        console.error('Failed to claim reserve and save task:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  // Remove reserve for a project (cleanup)
  ipcMain.handle(
    'worktree:removeReserve',
    async (event, args: { projectId: string; projectPath?: string; isRemote?: boolean }) => {
      try {
        if (args.isRemote) {
          return { success: true };
        }

        let projectPath = args.projectPath;
        if (!projectPath) {
          const project = await resolveProjectByIdOrPath({ projectId: args.projectId });
          if (!project) {
            await worktreePoolService.removeReserve(args.projectId);
            return { success: true };
          }
          if (isRemoteProject(project)) {
            return { success: true };
          }
          projectPath = project.path;
        }

        await worktreePoolService.removeReserve(args.projectId, projectPath);
        return { success: true };
      } catch (error) {
        console.error('Failed to remove reserve:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );
}
