import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import { Task } from 'vitest';
import { Conversation } from '@shared/conversations';
import { SshProject } from '@shared/projects';
import { Terminal } from '@shared/terminals';
import { SshConversationProvider } from '@main/core/conversations/impl/ssh-conversation';
import { SshFileSystem } from '@main/core/fs/impl/ssh-fs';
import { GitService } from '@main/core/git/impl/git-service';
import { openSsh2Pty } from '@main/core/pty/ssh2-pty';
import type { SshClientProxy } from '@main/core/ssh/ssh-client-proxy';
import {
  sshConnectionManager,
  type SshConnectionEvent,
} from '@main/core/ssh/ssh-connection-manager';
import { SshTerminalProvider } from '@main/core/terminals/impl/ssh-terminal-provider';
import { getSshExec } from '@main/core/utils/exec';
import { log } from '@main/lib/logger';
import { quoteShellArg } from '@main/utils/shellEscape';
import type { BaseTaskProvisionArgs, ProjectProvider, TaskProvider } from './project-provider';
import { ProjectSettingsProvider } from './settings/schema';

interface SshProvisionArgs extends BaseTaskProvisionArgs {
  workingDirectory: string;
}

export async function createSshProvider(project: SshProject): Promise<SshProjectProvider> {
  try {
    const proxy = await sshConnectionManager.connect(project.connectionId);
    return new SshProjectProvider(project.id, project.connectionId, proxy);
  } catch (error) {
    log.warn('createSshProvider: SSH connection failed', {
      projectId: project.id,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export class SshProjectProvider implements ProjectProvider {
  readonly type = 'ssh';
  readonly settings: ProjectSettingsProvider;

  private environments = new Map<string, TaskProvider>();
  private agentProviders = new Map<string, SshConversationProvider>();
  private terminalProviders = new Map<string, SshTerminalProvider>();
  private cachedSftp: SFTPWrapper | undefined;

  constructor(
    private readonly projectId: string,
    private readonly connectionId: string,
    private readonly proxy: SshClientProxy
  ) {
    sshConnectionManager.on('connection-event', this.handleConnectionEvent);
  }

  private handleConnectionEvent = (evt: SshConnectionEvent): void => {
    if (evt.type === 'reconnected' && evt.connectionId === this.connectionId) {
      this.rehydrateTerminals().catch((e: unknown) => {
        log.error('SshProjectProvider: rehydrateTerminals failed after reconnect', {
          projectId: this.projectId,
          connectionId: this.connectionId,
          error: String(e),
        });
      });
    }
  };

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

  async provisionTask(
    task: Task,
    conversations: Conversation[],
    terminals: Terminal[]
  ): Promise<TaskProvider> {
    const existing = this.environments.get(task.id);
    if (existing) return existing;

    const fs = new SshFileSystem(this.proxy, workingDirectory);
    const git = new GitService(workingDirectory, getSshExec(this.proxy), fs);

    const agentProvider = new SshConversationProvider(this.projectId, taskId, this.proxy);
    const terminalProvider = new SshTerminalProvider(this.projectId, taskId, this.proxy);

    this.agentProviders.set(taskId, agentProvider);
    this.terminalProviders.set(taskId, terminalProvider);

    const getPty = async () => {
      const command = `cd ${quoteShellArg(workingDirectory)} && exec $SHELL -l`;
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

    const taskEnv: TaskProvider = {
      taskId,
      taskPath: workingDirectory,
      fs,
      git,
      agentProvider,
      terminals: terminalProvider,
      getPty,
    };

    this.environments.set(taskId, taskEnv);

    // Hydrate existing terminal sessions immediately on startup.
    await Promise.all(
      terminals.map((term) =>
        terminalProvider
          .spawnTerminal({
            projectId: this.projectId,
            terminalId: term.id,
            taskId,
            cwd: workingDirectory,
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

  getTask(taskId: string): TaskProvider | undefined {
    return this.environments.get(taskId);
  }

  async teadownTask(taskId: string): Promise<void> {
    this.agentProviders.get(taskId)?.destroyAll();
    this.terminalProviders.get(taskId)?.destroyAll();
    this.agentProviders.delete(taskId);
    this.terminalProviders.delete(taskId);
    this.environments.delete(taskId);
  }

  async cleanup(): Promise<void> {
    sshConnectionManager.off('connection-event', this.handleConnectionEvent);
    await Promise.all(Array.from(this.environments.keys()).map((id) => this.teadownTask(id)));
  }

  /**
   * Re-spawn all terminal sessions for every active task after an SSH reconnect.
   * Agent sessions are intentionally excluded — they must be restarted manually.
   */
  private async rehydrateTerminals(): Promise<void> {
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
