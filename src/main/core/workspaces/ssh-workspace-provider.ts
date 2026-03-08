import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import { SshAgentProvider } from '@main/core/conversations/agent-provider/ssh-agent';
import { SshFileSystem } from '@main/core/fs/fs-provider/ssh-fs';
import { SshGitService } from '@main/core/git/git-provider/ssh-git-provider';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import { SshTerminalProvider } from '@main/core/terminals/terminal-provider/ssh-terminal-provider';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { EnvironmentProvider, ProvisionArgs, TaskEnvironment } from './workspace-provider';

export class SshEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'ssh';

  private environments = new Map<string, TaskEnvironment>();
  private agentProviders = new Map<string, SshAgentProvider>();
  private terminalProviders = new Map<string, SshTerminalProvider>();
  private cachedSftp: SFTPWrapper | undefined;

  constructor(
    private readonly projectId: string,
    private readonly proxy: SshClientProxy
  ) {}

  private getSftp(): Promise<SFTPWrapper> {
    if (this.cachedSftp) return Promise.resolve(this.cachedSftp);
    return new Promise((resolve, reject) => {
      this.proxy.client.sftp((err, sftp) => {
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

    const fs = new SshFileSystem(this.proxy, task.path);
    const git = new SshGitService(this.proxy, task.path);

    const agentProvider = new SshAgentProvider(this.projectId, task.id, this.proxy);
    const terminalProvider = new SshTerminalProvider(this.projectId, task.id, this.proxy);

    this.agentProviders.set(task.id, agentProvider);
    this.terminalProviders.set(task.id, terminalProvider);

    const getPty = async () => {
      const command = `cd ${quoteShellArg(task.path)} && exec $SHELL -l`;
      const result = await openSsh2Pty(this.proxy.client, {
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
   * Re-spawn all terminal sessions for every active task. Called by
   * EnvironmentProviderManager after a successful SSH reconnect.
   * Agent sessions are intentionally excluded — they must be restarted
   * manually by the user.
   */
  async rehydrateTerminals(): Promise<void> {
    await Promise.all(
      Array.from(this.terminalProviders.values()).map((provider) =>
        provider.rehydrate().catch((e: unknown) => {
          log.error('SshEnvironmentProvider: rehydrateTerminals failed for a provider', {
            error: String(e),
          });
        })
      )
    );
  }

  /**
   * Upload local files into the task's working directory via SFTP and return
   * their remote paths.
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
