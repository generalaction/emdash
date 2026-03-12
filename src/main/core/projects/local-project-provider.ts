import { Conversation } from '@shared/conversations/types';
import { LocalProject } from '@shared/projects/types';
import { Terminal } from '@shared/terminal/types';
import { LocalFileSystem } from '@main/core/fs/impl/local-fs';
import { LocalGitService } from '@main/core/git/impl/local-git-provider';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildSessionEnv } from '@main/core/pty/pty-env';
import { log } from '@main/lib/logger';
import { LocalConversationProvider } from '../conversations/impl/local-conversation';
import { LocalTerminalProvider } from '../terminals/terminal-provider/local-terminal-provider';
import type { ProjectProvider, TaskProvider } from './project-provider';
import { LocalProjectSettingsProvider } from './settings/project-settings';
import type { ProjectSettingsProvider } from './settings/schema';
import { WorktreeService } from './worktrees/worktree-service';

interface LocalProvisionArgs {
  taskId: string;
  projectPath: string;
  sourceBranch: string;
  taskBranch?: string;
  worktreePath?: string;
  createBranch?: boolean;
  branchName?: string;
  conversations: Conversation[];
  terminals: Terminal[];
}

export class LocalProjectProvider implements ProjectProvider<LocalProvisionArgs> {
  readonly type = 'local';

  private tasks = new Map<string, TaskProvider>();
  private conversations = new Map<string, LocalConversationProvider>();
  private terminals = new Map<string, LocalTerminalProvider>();
  private settings: ProjectSettingsProvider;
  private worktreeService: WorktreeService;

  constructor(private readonly project: LocalProject) {
    this.settings = new LocalProjectSettingsProvider(project.path);
    this.worktreeService = new WorktreeService({});
  }

  async provisionTask(args: LocalProvisionArgs) {
    const existing = this.tasks.get(args.taskId);
    if (existing) return existing;

    const worktreePath = args.worktreePath;

    // if (args.createBranch && !worktreePath) {
    //   const claim = await worktreePoolService.claimReserve(
    //     this.projectId,
    //     args.projectPath,
    //     args.branchName ?? '',
    //     args.sourceBranch
    //   );
    //   worktreePath = claim?.worktree.path;

    //   if (!claim?.worktree) {
    //     const worktreeService = createLocalWorktreeService(
    //       args.projectPath,
    //       settingsService.getWorktreesDir()
    //     );

    //     const worktree = await worktreeService.createWorktree(
    //       args.branchName ?? '',
    //       args.sourceBranch
    //     );
    //     worktreePath = worktree.path;
    //   }
    // }

    const workDir = worktreePath ?? args.projectPath;

    const fs = new LocalFileSystem(workDir);
    const git = new LocalGitService(workDir);

    const agentProvider = new LocalConversationProvider(this.projectId, args.taskId);
    const terminalProvider = new LocalTerminalProvider(this.projectId, args.taskId);
    this.conversations.set(args.taskId, agentProvider);
    this.terminals.set(args.taskId, terminalProvider);

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
      taskId: args.taskId,
      taskPath: workDir,
      fs,
      git,
      agentProvider,
      terminalProvider,
      getPty,
    };

    this.tasks.set(args.taskId, taskEnv);

    // Hydrate existing terminal sessions immediately on startup.
    await Promise.all(
      args.terminals.map((term) =>
        terminalProvider
          .spawnTerminal({
            projectId: this.projectId,
            terminalId: term.id,
            taskId: args.taskId,
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

    return taskEnv;
  }

  getTask(taskId: string): TaskProvider | undefined {
    return this.tasks.get(taskId);
  }

  async teadownTask(taskId: string): Promise<void> {
    this.conversations.get(taskId)?.destroyAll();
    this.terminals.get(taskId)?.destroyAll();
    this.conversations.delete(taskId);
    this.terminals.delete(taskId);
    this.tasks.delete(taskId);
  }

  async cleanup(): Promise<void> {
    await Promise.all(Array.from(this.tasks.keys()).map((id) => this.teadownTask(id)));
  }
}
