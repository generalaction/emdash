import fs from 'node:fs';
import path from 'node:path';
import { Conversation } from '@shared/conversations';
import { LocalProject } from '@shared/projects';
import { Task } from '@shared/tasks';
import { createScriptTerminalId, Terminal } from '@shared/terminals';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import type { FileSystemProvider } from '@main/core/fs/types';
import { GitService } from '@main/core/git/impl/git-service';
import type { GitProvider } from '@main/core/git/types';
import { getLocalExec } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { LocalConversationProvider } from '../../conversations/impl/local-conversation';
import { appSettingsService } from '../../settings/settings-service';
import { LocalTerminalProvider } from '../../terminals/impl/local-terminal-provider';
import type { ProjectProvider, TaskProvider } from '../project-provider';
import { LocalProjectSettingsProvider } from '../settings/project-settings';
import type { ProjectSettingsProvider } from '../settings/schema';
import { WorktreeService } from '../worktrees/worktree-service';

export async function createLocalProvider(project: LocalProject): Promise<LocalProjectProvider> {
  const slash = project.baseRef.indexOf('/');
  const bareDefaultBranch = slash !== -1 ? project.baseRef.slice(slash + 1) : project.baseRef;

  const defaultWorktreeDirectory = (await appSettingsService.get('localProject'))
    .defaultWorktreeDirectory;
  const worktreePoolPath = path.join(defaultWorktreeDirectory, project.name);

  await fs.promises.mkdir(worktreePoolPath, { recursive: true });

  return new LocalProjectProvider(project, {
    worktreePoolPath,
    defaultBranch: bareDefaultBranch,
  });
}

export class LocalProjectProvider implements ProjectProvider {
  readonly type = 'local';
  readonly settings: ProjectSettingsProvider;
  readonly git: GitProvider;
  readonly fs: FileSystemProvider;

  private tasks = new Map<string, TaskProvider>();
  private worktreeService: WorktreeService;

  constructor(
    private readonly project: LocalProject,
    options: {
      worktreePoolPath: string;
      defaultBranch: string;
    }
  ) {
    this.settings = new LocalProjectSettingsProvider(project.path);
    this.fs = new LocalFileSystem(project.path);
    this.git = new GitService(project.path, getLocalExec(), this.fs);
    this.worktreeService = new WorktreeService({
      worktreePoolPath: options.worktreePoolPath,
      defaultBranch: options.defaultBranch,
      repoPath: project.path,
      projectSettings: this.settings,
      exec: getLocalExec(),
    });
  }

  async provisionTask(task: Task, conversations: Conversation[], terminals: Terminal[]) {
    const existing = this.tasks.get(task.id);
    if (existing) return existing;

    let workDir: string;

    if (task.taskBranch) {
      if (await this.worktreeService.getWorktree(task.taskBranch)) {
        workDir = (await this.worktreeService.getWorktree(task.taskBranch))!;
      } else {
        workDir = await this.worktreeService.claimReserve(task.sourceBranch, task.taskBranch, {
          syncWithRemote: true,
        });
      }
    } else {
      workDir = this.project.path;
    }

    const fs = new LocalFileSystem(workDir);
    const git = new GitService(workDir, getLocalExec(), fs);
    const conversationProvider = new LocalConversationProvider({
      projectId: this.project.id,
      taskPath: workDir,
      taskId: task.id,
    });

    const terminalProvider = new LocalTerminalProvider({
      projectId: this.project.id,
      taskId: task.id,
      taskPath: workDir,
    });

    const taskEnv: TaskProvider = {
      taskId: task.id,
      taskPath: workDir,
      fs,
      git,
      conversations: conversationProvider,
      terminals: terminalProvider,
    };

    this.tasks.set(task.id, taskEnv);

    const scripts = (await this.settings.get()).scripts;

    const userShell =
      process.env.SHELL ?? (process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash');

    if (scripts?.setup) {
      const id = await createScriptTerminalId({
        projectId: this.project.id,
        taskId: task.id,
        type: 'setup',
        script: scripts.setup,
      });
      terminalProvider.spawnTerminal(
        { id, projectId: this.project.id, taskId: task.id, name: '' },
        { cols: 80, rows: 24 },
        { command: userShell, args: ['-c', scripts.setup] }
      );
    }

    Promise.all(
      terminals.map((term) =>
        terminalProvider.spawnTerminal(term).catch((e) => {
          log.error('LocalEnvironmentProvider: failed to hydrate terminal', {
            terminalId: term.id,
            error: String(e),
          });
        })
      )
    );

    Promise.all(
      conversations.map((conv) =>
        conversationProvider.startSession(conv).catch((e) => {
          log.error('LocalEnvironmentProvider: failed to hydrate conversation', {
            conversationId: conv.id,
            error: String(e),
          });
        })
      )
    );

    return taskEnv;
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this.tasks.get(taskId);
  }

  async teadownTask(taskId: string): Promise<void> {
    const task = this.tasks.get(taskId);
    if (!task) return;

    // run teardown script

    await task.conversations.destroyAll();
    await task.terminals.destroyAll();
    this.tasks.delete(taskId);
  }

  async cleanup(): Promise<void> {
    await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teadownTask(id)));
  }
}
