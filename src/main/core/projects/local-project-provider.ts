import { Conversation } from '@shared/conversations/types';
import { LocalProject } from '@shared/projects/types';
import { Task } from '@shared/tasks/types';
import { Terminal } from '@shared/terminal/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { LocalGitService } from '@main/core/git/impl/local-git-provider';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildSessionEnv } from '@main/core/pty/pty-env';
import { log } from '@main/lib/logger';
import { LocalConversationProvider } from '../conversations/impl/local-conversation';
import { appSettingsService } from '../settings/settings-service';
import { LocalTerminalProvider } from '../terminals/impl/local-terminal-provider';
import type { ProjectProvider, TaskProvider } from './project-provider';
import { LocalProjectSettingsProvider } from './settings/project-settings';
import type { ProjectSettingsProvider } from './settings/schema';
import { getLocalExec } from './utils';
import { WorktreeService } from './worktrees/worktree-service';

export async function createLocalProvider(project: LocalProject): Promise<LocalProjectProvider> {
  return new LocalProjectProvider(project, {
    worktreePoolPath: (await appSettingsService.getAppSettingsKey('localProject'))
      .defaultWorktreeDirectory,
    defaultBranch: project.baseRef,
  });
}

export class LocalProjectProvider implements ProjectProvider {
  readonly type = 'local';
  readonly settings: ProjectSettingsProvider;

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
    this.worktreeService = new WorktreeService({
      worktreePoolPath: options.worktreePoolPath,
      defaultBranch: options.defaultBranch,
      repoPath: project.path,
      exec: getLocalExec(),
    });
  }

  async provisionTask(args: Task, conversations: Conversation[], terminals: Terminal[]) {
    const existing = this.tasks.get(args.id);
    if (existing) return existing;

    let workDir: string;

    if (args.taskBranch) {
      if (await this.worktreeService.getWorktree(args.taskBranch)) {
        workDir = (await this.worktreeService.getWorktree(args.taskBranch))!;
      } else {
        workDir = await this.worktreeService.claimReserve(args.sourceBranch, args.taskBranch, {
          syncWithRemote: true,
        });
      }
    } else {
      workDir = this.project.path;
    }

    const fs = new LocalFileSystem(workDir);
    const git = new LocalGitService(workDir);
    const conversationProvider = new LocalConversationProvider(this.project.id, args.id);
    const terminalProvider = new LocalTerminalProvider(this.project.id, args.id);

    const env = buildSessionEnv('lifecycle');

    const getPty = async () => {
      const result = spawnLocalPty({
        id: crypto.randomUUID(),
        command: process.env.SHELL ?? '/bin/sh',
        args: [],
        cwd: workDir,
        env,
        cols: 80,
        rows: 24,
      });
      if (!result.success) {
        throw new Error(`Failed to spawn lifecycle PTY: ${result.error.kind}`);
      }
      return result.data;
    };

    const taskEnv: TaskProvider = {
      taskId: args.id,
      taskPath: workDir,
      fs,
      git,
      conversationProvider,
      terminalProvider,
      getPty,
    };

    this.tasks.set(args.id, taskEnv);

    // run the setup script

    Promise.all(
      terminals.map((term) =>
        terminalProvider
          .spawnTerminal({
            projectId: this.project.id,
            terminalId: term.id,
            taskId: args.id,
            cwd: workDir,
          })
          .catch((e) => {
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

    await task.conversationProvider.destroyAll();
    this.tasks.delete(taskId);
  }

  async cleanup(): Promise<void> {
    await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teadownTask(id)));
  }
}
