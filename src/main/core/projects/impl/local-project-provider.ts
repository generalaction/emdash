import fs from 'node:fs';
import path from 'node:path';
import type { Conversation } from '@shared/conversations';
import { gitRefChangedChannel } from '@shared/events/gitEvents';
import { bareRefName } from '@shared/git-utils';
import type { LocalProject } from '@shared/projects';
import { makePtySessionId } from '@shared/ptySessionId';
import type { Task } from '@shared/tasks';
import type { Terminal } from '@shared/terminals';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitWatcherService } from '@main/core/git/git-watcher-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import type {
  ProjectProvider,
  ProvisionResult,
  TaskProvider,
} from '@main/core/projects/project-provider';
import { LocalProjectSettingsProvider } from '@main/core/projects/settings/project-settings';
import { provisionLocalTask } from '@main/core/projects/task-builder';
import { TaskProvisionManager } from '@main/core/projects/task-provision-manager';
import { WorktreeService } from '@main/core/projects/worktrees/worktree-service';
import { killTmuxSession, makeTmuxSessionName } from '@main/core/pty/tmux-session-name';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import { getTaskSessionLeafIds } from '@main/core/tasks/session-targets';
import { getGitLocalExec, getLocalExec } from '@main/core/utils/exec';
import { provisionBYOITask } from '@main/core/workspaces/byoi/provision-byoi-task';
import { localWorkspaceId } from '@main/core/workspaces/workspace-id';
import { workspaceRegistry, type TeardownMode } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { log } from '@main/lib/logger';

export async function createLocalProvider(
  project: LocalProject,
  rootFs: FileSystemProvider
): Promise<ProjectProvider> {
  const settings = new LocalProjectSettingsProvider(
    project.path,
    bareRefName(project.baseRef),
    rootFs
  );
  const worktreePoolPath = path.join(await settings.getWorktreeDirectory(), project.name);
  await fs.promises.mkdir(worktreePoolPath, { recursive: true });

  const localFs = new LocalFileSystem(project.path);
  const gitExec = getGitLocalExec(() => githubConnectionService.getToken());
  const repoGit = new GitService(project.path, gitExec, localFs);
  const repository = new GitRepositoryService(repoGit, settings);
  const worktreeService = new WorktreeService({
    worktreePoolPath,
    repoPath: project.path,
    projectSettings: settings,
    exec: gitExec,
    rootFs,
  });
  const gitWatcher = new GitWatcherService(project.id, project.path);
  void gitWatcher.start();

  const gitFetchService = new GitFetchService(
    repoGit,
    async () => (await githubConnectionService.getToken()) !== null
  );
  gitFetchService.start();

  const configChangeUnsub = events.on(gitRefChangedChannel, (p) => {
    if (p.projectId === project.id && p.kind === 'config') {
      void prSyncScheduler.onRemoteChanged(project.id);
    }
  });

  const localExec = getLocalExec();

  async function doProvisionTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<ProvisionResult> {
    log.debug('LocalProjectProvider: doProvisionTask START', { taskId: task.id });

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
        execFn: localExec,
        projectId: project.id,
        projectPath: project.path,
        settings,
        logPrefix: 'LocalProjectProvider[byoi]',
      });
    }

    void gitFetchService.fetch();
    void prSyncScheduler.onTaskProvisioned(project.id, task.taskBranch);

    const workspaceId = localWorkspaceId(project.id, task.taskBranch);

    const { provisionResult, workspace } = await provisionLocalTask({
      task,
      conversations,
      terminals,
      workspaceId,
      type: { kind: 'local' },
      projectId: project.id,
      projectPath: project.path,
      settings,
      worktreeService,
      fetchService: gitFetchService,
      repository,
      logPrefix: 'LocalProjectProvider',
    });

    const mainDotGitAbs = path.resolve(project.path, '.git');
    const relativeGitDir = await workspace.git.getWorktreeGitDir(mainDotGitAbs);
    gitWatcher.registerWorktree(workspaceId, relativeGitDir);

    return provisionResult;
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
    gitWatcher.unregisterWorktree(workspaceId);
  }

  async function cleanupDetachedTmuxSessions(taskId: string): Promise<void> {
    const { conversationIds, terminalIds } = await getTaskSessionLeafIds(project.id, taskId);
    const sessionIds = [...conversationIds, ...terminalIds].map((leafId) =>
      makePtySessionId(project.id, taskId, leafId)
    );
    await Promise.all(
      sessionIds.map((sessionId) => killTmuxSession(localExec, makeTmuxSessionName(sessionId)))
    );
  }

  const taskManager = new TaskProvisionManager(
    'LocalProjectProvider',
    doProvisionTask,
    doTeardownTask,
    cleanupDetachedTmuxSessions
  );

  return {
    type: 'local',
    settings,
    repository,
    fs: localFs,
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
      configChangeUnsub();
      gitFetchService.stop();
      await gitWatcher.stop();
      const projectSettings = await settings.get();
      const mode = projectSettings.tmux ? 'detach' : 'terminate';
      await taskManager.teardownAll({ mode });
      await workspaceRegistry.releaseAllForProject(project.id, mode);
    },
  };
}
