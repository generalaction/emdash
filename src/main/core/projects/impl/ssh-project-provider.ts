import path from 'node:path';
import { bareRefName } from '@shared/git-utils';
import type { SshProject } from '@shared/projects';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { getGitSshExec, getSshExec } from '@main/core/utils/exec';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { log } from '@main/lib/logger';
import { type ProjectProvider } from '../project-provider';
import { SshProjectSettingsProvider } from '../settings/project-settings';
import { taskManager } from '../task-manager';
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

    function handleConnectionEvent(evt: SshConnectionEvent): void {
      if (evt.type === 'reconnected' && evt.connectionId === project.connectionId) {
        void gitFetchService.fetch();
      }
    }

    sshConnectionManager.on('connection-event', handleConnectionEvent);

    return {
      type: 'ssh',
      projectId: project.id,
      repoPath: project.path,
      exec,
      settings,
      repository,
      fs: projectFs,
      worktreeService,
      gitFetchService,
      workspaceType: { kind: 'ssh', proxy, connectionId: project.connectionId },
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
        await taskManager.teardownAllForProject(project.id, mode);
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
