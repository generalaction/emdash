import { app, BrowserWindow, ipcMain } from 'electron';
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
import {
  isRemoteProject,
  resolveRemoteProjectForWorktreePath,
} from '../utils/remoteProjectResolver';
import {
  WORKTREE_CREATION_EVENT_CHANNEL,
  type WorktreeCreationEvent,
} from '@shared/worktreeCreation';

const remoteGitService = new RemoteGitService(sshService);
let worktreeQuitCleanupRegistered = false;

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

// isRemoteProject and resolveRemoteProjectForWorktreePath imported from ../utils/remoteProjectResolver

export function registerWorktreeIpc(): void {
  if (!worktreeQuitCleanupRegistered) {
    worktreeQuitCleanupRegistered = true;
    app.on('before-quit', () => {
      void worktreeService.cancelAllCreateWorktreeJobs('Application is closing');
    });
  }

  const sendToAllWindows = (event: WorktreeCreationEvent): void => {
    const all = BrowserWindow.getAllWindows();
    for (const win of all) {
      try {
        win.webContents.send(WORKTREE_CREATION_EVENT_CHANNEL, event);
      } catch {}
    }
  };

  const outputBuffers = new Map<
    string,
    {
      projectId: string;
      stdout: string;
      stderr: string;
      timer: NodeJS.Timeout | null;
    }
  >();

  const flushBufferedOutput = (taskId: string): void => {
    const buffered = outputBuffers.get(taskId);
    if (!buffered) return;

    if (buffered.stdout) {
      sendToAllWindows({
        taskId,
        projectId: buffered.projectId,
        status: 'progress',
        timestamp: new Date().toISOString(),
        stream: 'stdout',
        chunk: buffered.stdout,
      });
      buffered.stdout = '';
    }

    if (buffered.stderr) {
      sendToAllWindows({
        taskId,
        projectId: buffered.projectId,
        status: 'progress',
        timestamp: new Date().toISOString(),
        stream: 'stderr',
        chunk: buffered.stderr,
      });
      buffered.stderr = '';
    }

    if (!buffered.stdout && !buffered.stderr) {
      if (buffered.timer) {
        clearTimeout(buffered.timer);
      }
      outputBuffers.delete(taskId);
      return;
    }

    buffered.timer = setTimeout(() => {
      flushBufferedOutput(taskId);
    }, 100);
  };

  const bufferProgressEvent = (event: WorktreeCreationEvent): void => {
    if (event.status !== 'progress' || !event.stream || !event.chunk) {
      flushBufferedOutput(event.taskId);
      sendToAllWindows(event);
      return;
    }

    const existing = outputBuffers.get(event.taskId) ?? {
      projectId: event.projectId,
      stdout: '',
      stderr: '',
      timer: null,
    };

    if (event.stream === 'stdout') {
      existing.stdout = `${existing.stdout}${event.chunk}`.slice(-16_384);
    } else {
      existing.stderr = `${existing.stderr}${event.chunk}`.slice(-16_384);
    }

    outputBuffers.set(event.taskId, existing);

    if (!existing.timer) {
      existing.timer = setTimeout(() => {
        flushBufferedOutput(event.taskId);
      }, 100);
    }
  };

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

  ipcMain.handle(
    'worktree:startTaskCreation',
    async (
      _event,
      args: {
        projectId: string;
        projectPath: string;
        taskName: string;
        baseRef?: string;
        task: {
          projectId: string;
          name: string;
          status: 'active' | 'idle' | 'running' | 'creating' | 'error';
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
        if (!project) {
          return { success: false, error: 'Project not found' };
        }

        if (isRemoteProject(project)) {
          const baseRef = args.baseRef ?? project.gitInfo.baseRef;
          const remote = await remoteGitService.createWorktree(
            project.sshConnectionId,
            project.remotePath,
            args.taskName,
            baseRef
          );
          const remoteTaskId = stableIdFromRemotePath(remote.path);
          const persistedTask = {
            id: remoteTaskId,
            projectId: args.projectId,
            name: args.taskName,
            branch: remote.branch,
            path: remote.path,
            status: 'idle' as const,
            agentId: args.task.agentId ?? null,
            metadata: args.task.metadata ?? null,
            useWorktree: args.task.useWorktree !== false,
          };
          await databaseService.saveTask(persistedTask);
          return { success: true, task: persistedTask, completed: true };
        }

        const claim = await worktreePoolService.claimReserve(
          args.projectId,
          args.projectPath,
          args.taskName,
          args.baseRef
        );

        if (claim) {
          const persistedTask = {
            id: claim.worktree.id,
            projectId: args.projectId,
            name: args.taskName,
            branch: claim.worktree.branch,
            path: claim.worktree.path,
            status: 'idle' as const,
            agentId: args.task.agentId ?? null,
            metadata: args.task.metadata ?? null,
            useWorktree: args.task.useWorktree !== false,
          };
          await databaseService.saveTask(persistedTask);
          return {
            success: true,
            task: persistedTask,
            completed: true,
            needsBaseRefSwitch: claim.needsBaseRefSwitch,
          };
        }

        const { worktree, completion } = await worktreeService.startCreateWorktreeJob({
          projectPath: args.projectPath,
          taskName: args.taskName,
          projectId: args.projectId,
          baseRef: args.baseRef,
          onEvent: (event) => {
            bufferProgressEvent(event);
          },
        });

        const persistedTask = {
          id: worktree.id,
          projectId: args.projectId,
          name: args.taskName,
          branch: worktree.branch,
          path: worktree.path,
          status: 'creating' as const,
          agentId: args.task.agentId ?? null,
          metadata: args.task.metadata ?? null,
          useWorktree: args.task.useWorktree !== false,
        };

        await databaseService.saveTask(persistedTask);

        void completion.then(
          async (createdWorktree) => {
            const latest = await databaseService.getTaskById(createdWorktree.id);
            if (!latest) {
              return;
            }
            await databaseService.saveTask({
              ...latest,
              branch: createdWorktree.branch,
              path: createdWorktree.path,
              status: 'idle',
            });
          },
          async (error) => {
            const message = error instanceof Error ? error.message : String(error);
            if (/cancel/i.test(message)) {
              return;
            }
            const latest = await databaseService.getTaskById(worktree.id);
            if (!latest) {
              return;
            }
            await databaseService.saveTask({
              ...latest,
              status: 'error',
            });
          }
        );

        return {
          success: true,
          task: persistedTask,
          completed: false,
        };
      } catch (error) {
        log.error('Failed to start async task worktree creation:', error);
        return { success: false, error: (error as Error).message };
      }
    }
  );

  ipcMain.handle(
    'worktree:cancelTaskCreation',
    async (_event, args: { taskId: string; reason?: string }) => {
      try {
        const cancelled = await worktreeService.cancelCreateWorktreeJob(args.taskId, args.reason);
        return { success: true, cancelled };
      } catch (error) {
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

  // Preflight freshness check — called when create-task UI opens so the
  // ls-remote cost is hidden behind user interaction time.
  ipcMain.handle(
    'worktree:preflightReserve',
    async (
      event,
      args: {
        projectId: string;
        projectPath: string;
      }
    ) => {
      try {
        const project = await resolveProjectByIdOrPath({
          projectId: args.projectId,
          projectPath: args.projectPath,
        });
        if (isRemoteProject(project)) {
          return { success: true };
        }
        await worktreePoolService.preflightCheck(args.projectId, args.projectPath);
        return { success: true };
      } catch (error) {
        console.error('Failed to preflight reserve:', error);
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
          status: 'active' | 'idle' | 'running' | 'creating' | 'error';
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
