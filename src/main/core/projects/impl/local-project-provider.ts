import fs from 'node:fs';
import path from 'node:path';
import { gitRefChangedChannel } from '@shared/events/gitEvents';
import { bareRefName } from '@shared/git-utils';
import type { LocalProject } from '@shared/projects';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { GitFetchService } from '@main/core/git/git-fetch-service';
import { GitService } from '@main/core/git/impl/git-service';
import { GitRepositoryService } from '@main/core/git/repository-service';
import { githubConnectionService } from '@main/core/github/services/github-connection-service';
import type { ProjectProvider } from '@main/core/projects/project-provider';
import { LocalProjectSettingsProvider } from '@main/core/projects/settings/project-settings';
import { WorktreeService } from '@main/core/projects/worktrees/worktree-service';
import { prSyncScheduler } from '@main/core/pull-requests/pr-sync-scheduler';
import { getGitLocalExec, getLocalExec } from '@main/core/utils/exec';
import { workspaceRegistry } from '@main/core/workspaces/workspace-registry';
import { events } from '@main/lib/events';
import { taskManager } from '../task-manager';
import { LocalWorktreeHost } from '../worktrees/hosts/local-worktree-host';

export async function createLocalProvider(project: LocalProject): Promise<ProjectProvider> {
  const settings = new LocalProjectSettingsProvider(project.path, bareRefName(project.baseRef));
  const worktreePoolPath = path.join(await settings.getWorktreeDirectory(), project.name);
  await fs.promises.mkdir(worktreePoolPath, { recursive: true });

  const worktreeHost = await LocalWorktreeHost.create({ allowedRoots: [project.path] });

  const localFs = new LocalFileSystem(project.path);
  const gitExec = getGitLocalExec(() => githubConnectionService.getToken());
  const repoGit = new GitService(project.path, gitExec, localFs);
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

  const configChangeUnsub = events.on(gitRefChangedChannel, (p) => {
    if (p.projectId === project.id && p.kind === 'config') {
      void prSyncScheduler.onRemoteChanged(project.id);
    }
  });

  const localExec = getLocalExec();

  return {
    type: 'local',
    projectId: project.id,
    repoPath: project.path,
    exec: localExec,
    settings,
    repository,
    fs: localFs,
    worktreeService,
    gitFetchService,
    workspaceType: { kind: 'local' },
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
      const projectSettings = await settings.get();
      const mode = projectSettings.tmux ? 'detach' : 'terminate';
      await taskManager.teardownAllForProject(project.id, mode);
      await workspaceRegistry.releaseAllForProject(project.id, mode);
    },
  };
}
