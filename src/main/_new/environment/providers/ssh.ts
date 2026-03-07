import type { SFTPWrapper } from 'ssh2';
import type { EnvironmentProvider, IShellRunner, TaskEnvironment, ExecResult } from '../types';
import type { ProjectRow } from '../../db/schema';
import { sshConnectionManager } from '../../pty/ssh-connection-manager';
import { db } from '../../db/client';
import { sshConnections } from '../../db/schema';
import { eq } from 'drizzle-orm';
import { RemoteFileSystem } from '../../services/fs/RemoteFileSystem';
import { SshGitService } from '../../services/SshGitService';
import { buildConnectConfigFromRow } from './build-connect-config';
import { quoteShellArg } from '../../../utils/shellEscape';
import type { SshService } from '../../../services/ssh/SshService';

/**
 * Thin adapter that wraps `SshConnectionManager`'s `ssh2.Client` to provide
 * `executeCommand` + `getSftp` — the only two methods that `RemoteFileSystem`
 * and `RemoteGitService` call on `SshService`.
 *
 * Using `as unknown as SshService` at the call-site is intentional: we are
 * duck-typing against a concrete class whose interface we cannot change here.
 */
class SshManagerAdapter {
  private sftpCache = new Map<string, SFTPWrapper>();

  async executeCommand(connectionId: string, command: string, cwd?: string): Promise<ExecResult> {
    const client = sshConnectionManager.getClient(connectionId);
    if (!client) {
      throw new Error(`SSH connection '${connectionId}' is not active in SshConnectionManager`);
    }
    const innerCmd = cwd ? `cd ${quoteShellArg(cwd)} && ${command}` : command;
    const fullCmd = `bash -l -c ${quoteShellArg(innerCmd)}`;

    return new Promise((resolve, reject) => {
      client.exec(fullCmd, (execErr, stream) => {
        if (execErr) return reject(execErr);
        let stdout = '';
        let stderr = '';
        stream.on('close', (code: number | null) => {
          resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? -1 });
        });
        stream.on('data', (d: Buffer) => {
          stdout += d.toString('utf-8');
        });
        stream.stderr.on('data', (d: Buffer) => {
          stderr += d.toString('utf-8');
        });
        stream.on('error', reject);
      });
    });
  }

  async getSftp(connectionId: string): Promise<SFTPWrapper> {
    const cached = this.sftpCache.get(connectionId);
    if (cached) return cached;

    const client = sshConnectionManager.getClient(connectionId);
    if (!client) {
      throw new Error(`SSH connection '${connectionId}' is not active in SshConnectionManager`);
    }
    return new Promise((resolve, reject) => {
      client.sftp((sftpErr, sftp) => {
        if (sftpErr) return reject(sftpErr);
        this.sftpCache.set(connectionId, sftp);
        sftp.on('close', () => {
          this.sftpCache.delete(connectionId);
        });
        resolve(sftp);
      });
    });
  }
}

/** One adapter instance per provider — the adapter itself is stateless per connection. */
const sshAdapter = new SshManagerAdapter();

class SshShellRunner implements IShellRunner {
  constructor(private connectionId: string) {}

  async exec(command: string, cwd: string): Promise<ExecResult> {
    return sshAdapter.executeCommand(this.connectionId, command, cwd);
  }
}

export class SshEnvironmentProvider implements EnvironmentProvider {
  readonly type = 'ssh';

  async provision(
    project: ProjectRow,
    task: { id: string; path: string }
  ): Promise<TaskEnvironment> {
    if (!project.sshConnectionId) {
      throw new Error(
        `Project '${project.name}' is configured as remote but has no sshConnectionId`
      );
    }
    if (!project.remotePath) {
      throw new Error(`Project '${project.name}' is configured as remote but has no remotePath`);
    }

    const connectionId = project.sshConnectionId;

    // Ensure an active connection exists in SshConnectionManager.
    if (!sshConnectionManager.isConnected(connectionId)) {
      const [row] = await db
        .select()
        .from(sshConnections)
        .where(eq(sshConnections.id, connectionId))
        .limit(1);
      if (!row) {
        throw new Error(`SSH connection row not found for id '${connectionId}'`);
      }
      const config = await buildConnectConfigFromRow(row);
      const result = await sshConnectionManager.connect(connectionId, config);
      if (!result.success) {
        throw new Error(`Failed to establish SSH connection: ${result.error.message}`);
      }
    }

    // RemoteFileSystem uses the adapter cast as SshService (duck-typed, intentional).
    const fs = new RemoteFileSystem(
      sshAdapter as unknown as SshService,
      connectionId,
      project.remotePath
    );
    const git = new SshGitService(connectionId);
    const shell = new SshShellRunner(connectionId);

    return {
      taskId: task.id,
      fs,
      git,
      shell,
      transport: 'ssh2',
      connectionId,
    };
  }

  async teardown(_taskId: string): Promise<void> {
    // The SSH connection is keyed by project.sshConnectionId, which may be
    // shared across multiple tasks in the same project.  We do not disconnect
    // here; project-level teardown is responsible for that.
  }
}

export const sshEnvironmentProvider = new SshEnvironmentProvider();
