import { LocalFileSystem } from '@main/core/fs/fs-provider/local-fs';
import { LocalGitService } from '@main/core/git/git-provider/local-git-provider';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildSessionEnv } from '@main/core/pty/pty-env';
import { log } from '@main/lib/logger';
import { LocalAgentProvider } from '../conversations/agent-provider/local-agent';
import { LocalTerminalProvider } from '../terminals/terminal-provider/local-terminal-provider';
import type { EnvironmentProvider, ProvisionArgs, TaskEnvironment } from './workspace-provider';

export class LocalEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'local';

  private environments = new Map<string, TaskEnvironment>();
  private agentProviders = new Map<string, LocalAgentProvider>();
  private terminalProviders = new Map<string, LocalTerminalProvider>();

  constructor(private readonly projectId: string) {}

  async provision({ task, projectPath, terminals }: ProvisionArgs): Promise<TaskEnvironment> {
    const existing = this.environments.get(task.id);
    if (existing) return existing;

    const fs = new LocalFileSystem(task.path);
    const git = new LocalGitService(task.path);

    const agentProvider = new LocalAgentProvider(this.projectId, task.id);
    const terminalProvider = new LocalTerminalProvider(this.projectId, task.id);

    this.agentProviders.set(task.id, agentProvider);
    this.terminalProviders.set(task.id, terminalProvider);

    const env = buildSessionEnv('lifecycle');

    const getPty = async () => {
      const result = spawnLocalPty({
        id: crypto.randomUUID(),
        command: process.env.SHELL ?? '/bin/sh',
        args: [],
        cwd: task.path,
        env,
        cols: 80,
        rows: 24,
      });
      if (!result.success) {
        throw new Error(`Failed to spawn lifecycle PTY: ${result.error.kind}`);
      }
      return result.data;
    };

    const taskEnv: TaskEnvironment = {
      taskId: task.id,
      taskPath: task.path,
      fs,
      git,
      agentProvider,
      terminalProvider,
      getPty,
    };

    this.environments.set(task.id, taskEnv);

    // Hydrate existing terminal sessions immediately on startup.
    await Promise.all(
      terminals.map((term) =>
        terminalProvider
          .spawnTerminal({
            projectId: this.projectId,
            terminalId: term.id,
            taskId: task.id,
            cwd: task.path,
            projectPath,
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

  getEnvironment(taskId: string): TaskEnvironment | undefined {
    return this.environments.get(taskId);
  }

  async teardown(taskId: string): Promise<void> {
    this.agentProviders.get(taskId)?.destroyAll();
    this.terminalProviders.get(taskId)?.destroyAll();
    this.agentProviders.delete(taskId);
    this.terminalProviders.delete(taskId);
    this.environments.delete(taskId);
  }

  async teardownAll(): Promise<void> {
    await Promise.all(Array.from(this.environments.keys()).map((id) => this.teardown(id)));
  }
}
