import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Client, SFTPWrapper } from 'ssh2';
import type { EnvironmentProvider, TaskEnvironment, ProvisionArgs } from '../environment-provider';
import { SshFileSystem } from './fs-provider/ssh-fs';
import { SshGitService } from './git-provider/ssh-git-provider';
import { openSsh2Pty } from '../../pty/ssh2-pty';
import { quoteShellArg } from '../../../_deprecated/utils/shellEscape';
import { log } from '../../lib/logger';
import { SshAgentProvider } from './agent-provider/ssh-agent';
import { SshTerminalProvider } from './terminal-provider/ssh-terminal-provider';

export class SshEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'ssh';

  private environments = new Map<string, TaskEnvironment>();
  private agentProviders = new Map<string, SshAgentProvider>();
  private terminalProviders = new Map<string, SshTerminalProvider>();
  private cachedSftp: SFTPWrapper | undefined;

  constructor(
    private readonly projectId: string,
    private readonly client: Client
  ) {}

  private getSftp(): Promise<SFTPWrapper> {
    if (this.cachedSftp) return Promise.resolve(this.cachedSftp);
    return new Promise((resolve, reject) => {
      this.client.sftp((err, sftp) => {
        if (err) return reject(err);
        this.cachedSftp = sftp;
        sftp.on('close', () => {
          this.cachedSftp = undefined;
        });
        resolve(sftp);
      });
    });
  }

  async provision({ task, projectPath, terminals }: ProvisionArgs): Promise<TaskEnvironment> {
    const existing = this.environments.get(task.id);
    if (existing) return existing;

    const fs = new SshFileSystem(this.client, task.path);
    const git = new SshGitService(this.client, task.path);

    const agentProvider = new SshAgentProvider(this.projectId, task.id, this.client);
    const terminalProvider = new SshTerminalProvider(this.projectId, task.id, this.client);

    this.agentProviders.set(task.id, agentProvider);
    this.terminalProviders.set(task.id, terminalProvider);

    const getPty = async () => {
      const command = `cd ${quoteShellArg(task.path)} && exec $SHELL -l`;
      const result = await openSsh2Pty(this.client, {
        id: crypto.randomUUID(),
        command,
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
          .catch((e: unknown) => {
            log.error('SshEnvironmentProvider: failed to hydrate terminal', {
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

  /**
   * Upload local files into the task's working directory via SFTP and return
   * their remote paths.  The destination directory is the task worktree path
   * so the agent can reference uploaded files by relative path.
   */
  async uploadFiles(taskId: string, localPaths: string[]): Promise<string[]> {
    const env = this.environments.get(taskId);
    if (!env) throw new Error(`No provisioned environment for task: ${taskId}`);

    const sftp = await this.getSftp();
    const destDir = env.taskPath;

    return Promise.all(
      localPaths.map(async (localPath) => {
        const remoteName = `${randomUUID()}-${path.basename(localPath)}`;
        const remotePath = `${destDir}/${remoteName}`;
        await new Promise<void>((resolve, reject) => {
          sftp.fastPut(localPath, remotePath, (e) => (e ? reject(e) : resolve()));
        });
        return remotePath;
      })
    );
  }
}
