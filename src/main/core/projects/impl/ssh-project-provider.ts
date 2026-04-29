import path from 'node:path';
import type { Conversation } from '@shared/conversations';
import { bareRefName } from '@shared/git-utils';
import type { SshProject } from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import type { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import type { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import { getGitSshExec, getSshExec } from '@main/core/utils/exec';
import { sshWorkspaceId } from '@main/core/workspaces/workspace-id';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import { provisionBYOITask } from '../../workspaces/byoi/provision-byoi-task';
import { type ProjectProvider, type ProvisionResult, type TaskProvider } from '../project-provider';
import { SshProjectSettingsProvider } from '../settings/project-settings';
import { provisionLocalTask } from '../task-builder';
import { TaskProvisionManager } from '../task-provision-manager';
import { SshWorktreeHost } from '../worktrees/hosts/ssh-worktree-host';
import { WorktreeService } from '../worktrees/worktree-service';

export async function createSshProvider(
  project: SshProject,
  rootFs: FileSystemProvider,
  proxy: SshClientProxy
): Promise<ProjectProvider> {
  try {
    const projectFs = new SshFileSystem(proxy, project.path);
    const exec = getSshExec(proxy);

    const settings = new SshProjectSettingsProvider(
      projectFs,
      bareRefName(project.baseRef),
      rootFs,
      project.path,
      exec
    );
    const worktreePoolPath = path.posix.join(await settings.getWorktreeDirectory(), project.name);
    const worktreeHost = new SshWorktreeHost(rootFs);
    await worktreeHost.mkdirAbsolute(worktreePoolPath, { recursive: true });

    const gitExec = getGitSshExec(proxy, () => githubConnectionService.getToken());
    const repoGit = new GitService(project.path, gitExec, projectFs, false);
    const repository = new GitRepositoryService(repoGit, settings);
    const worktreeService = new WorktreeService({
      worktreePoolPath,
      repoPath: project.path,
      projectSettings: settings,
      exec: gitExec,
      host: worktreeHost,
    });
    const gitFetchService = new GitFetchService(
      repoGit,
      async () => (await githubConnectionService.getToken()) !== null
    );
    gitFetchService.start();

    const conversationProviders = new Map<string, SshConversationProvider>();
    const terminalProviders = new Map<string, SshTerminalProvider>();

    async function doProvisionTask(
      task: Task,
      conversations: Conversation[],
      terminals: Terminal[]
    ): Promise<ProvisionResult> {
      log.debug('SshProjectProvider: doProvisionTask START', { taskId: task.id });

      if (task.workspaceProvider === 'byoi') {
        const projectSettings = await settings.get();
        if (projectSettings.workspaceProvider?.type !== 'script') {
          throw new Error(
            'Task has workspaceProvider=byoi but project has no script provider configured'
          );
        }
        return provisionBYOITask({
          task,
          conversations,
          terminals,
          wpConfig: projectSettings.workspaceProvider,
          execFn: getSshExec(proxy),
          projectId: project.id,
          projectPath: project.path,
          settings,
          logPrefix: 'SshProjectProvider[byoi]',
        });
      }

      void gitFetchService.fetch();
      void prSyncScheduler.onTaskProvisioned(project.id, task.taskBranch);

      const { provisionResult, buildTaskResult } = await provisionLocalTask({
        task,
        conversations,
        terminals,
        workspaceId: sshWorkspaceId(project.id, task.taskBranch),
        type: { kind: 'ssh', proxy },
        projectId: project.id,
        projectPath: project.path,
        settings,
        worktreeService,
        fetchService: gitFetchService,
        repository,
        logPrefix: 'SshProjectProvider',
      });

      terminalProviders.set(task.id, buildTaskResult.terminalProvider as SshTerminalProvider);
      conversationProviders.set(
        task.id,
        buildTaskResult.conversationProvider as SshConversationProvider
      );
      log.debug('SshProjectProvider: doProvisionTask DONE', { taskId: task.id });

      return {
        ...provisionResult,
        persistData: { ...provisionResult.persistData, sshConnectionId: project.connectionId },
      };
    }

    async function doTeardownTask(
      task: TaskProvider,
      workspaceId: string,
      mode: TeardownMode
    ): Promise<void> {
      if (mode === 'detach') {
        await task.conversations.detachAll();
        await task.terminals.detachAll();
      } else {
        await task.conversations.destroyAll();
        await task.terminals.destroyAll();
      }
      await workspaceRegistry.release(workspaceId, mode);
    }

    async function cleanupDetachedTmuxSessions(taskId: string): Promise<void> {
      const { conversationIds, terminalIds } = await getTaskSessionLeafIds(project.id, taskId);
      const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
        makePtySessionId(project.id, taskId, leafId)
      );
      const sshExec = getSshExec(proxy);
      await Promise.all(
        sessionIds.map((sessionId) => killTmuxSession(sshExec, makeTmuxSessionName(sessionId)))
      );
    }

    const taskManager = new TaskProvisionManager(
      'SshProjectProvider',
      doProvisionTask,
      doTeardownTask,
      cleanupDetachedTmuxSessions,
      (taskId) => {
        conversationProviders.delete(taskId);
        terminalProviders.delete(taskId);
      }
    );

    async function rehydrateTerminals(): Promise<void> {
      await Promise.all(
        Array.from(terminalProviders.values()).map((provider) =>
          provider.rehydrate().catch((e: unknown) => {
            log.error('SshEnvironmentProvider: rehydrateTerminals failed for a provider', {
              error: String(e),
            });
          })
        )
      );
    }

    function handleConnectionEvent(evt: SshConnectionEvent): void {
      if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
        void gitFetchService.fetch();
        rehydrateTerminals().catch((e: unknown) => {
          log.error('SshProjectProvider: rehydrateTerminals failed after reconnect', {
            projectId: project.id,
            connectionId: project.connectionId,
            error: String(e),
          });
        });
      }
    }

    sshConnectionManager.on('connection-event', handleConnectionEvent);

    return {
      type: 'ssh',
      settings,
      repository,
      fs: projectFs,
      tasks: taskManager,
      getWorktreeForBranch: (branch) => worktreeService.getWorktree(branch),
      removeTaskWorktree: async (taskBranch) => {
        const worktreePath = await worktreeService.getWorktree(taskBranch);
        if (worktreePath) {
          await worktreeService.removeWorktree(worktreePath);
        }
      },
      fetch: () => gitFetchService.fetch(),
      getRemoteState: () => repository.getRemoteState(),
      cleanup: async () => {
        gitFetchService.stop();
        sshConnectionManager.off('connection-event', handleConnectionEvent);
        const projectSettings = await settings.get();
        const mode = projectSettings.tmux ? 'detach' : 'terminate';
        await taskManager.teardownAll({ mode });
        await workspaceRegistry.releaseAllForProject(project.id, mode);
      },
    };
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
