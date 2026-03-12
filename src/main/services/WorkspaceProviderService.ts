import { EventEmitter } from 'node:events';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { log } from '../lib/logger';
import { getDrizzleClient } from '../db/drizzleClient';
import { workspaceInstances, sshConnections, type WorkspaceInstanceRow } from '../db/schema';
import { eq, and, inArray } from 'drizzle-orm';
import { sshService } from './ssh/SshService';

/** Default timeout for provision/terminate scripts (5 minutes). */
const PROVISION_TIMEOUT_MS = 5 * 60 * 1000;

/** Default timeout for terminate scripts (2 minutes). */
const TERMINATE_TIMEOUT_MS = 2 * 60 * 1000;

/**
 * JSON shape returned by the provision script on stdout.
 * Only `host` is required.
 */
export interface ProvisionOutput {
  id?: string;
  host: string;
  port?: number;
  username?: string;
  worktreePath?: string;
}

export interface ProvisionConfig {
  taskId: string;
  repoUrl: string;
  branch: string;
  baseRef: string;
  provisionCommand: string;
  projectPath: string;
}

export interface TerminateConfig {
  instanceId: string;
  terminateCommand: string;
  projectPath: string;
  /** Extra env vars forwarded to the terminate script. */
  env?: Record<string, string>;
}

/**
 * Manages remote workspace provisioning and termination via user-defined
 * shell scripts.  Emits events so the renderer can stream progress:
 *
 * - `provision-progress`  { instanceId, line }
 * - `provision-complete`  { instanceId, status, error? }
 */
export class WorkspaceProviderService extends EventEmitter {
  /** In-flight provision processes keyed by instanceId. */
  private provisionProcesses = new Map<string, ChildProcess>();

  // ---------------------------------------------------------------------------
  // Provision
  // ---------------------------------------------------------------------------

  /**
   * Starts provisioning a remote workspace.
   *
   * 1. Creates a `workspace_instances` row with status `provisioning`.
   * 2. Spawns the provision script as a child process.
   * 3. Streams stderr lines via `provision-progress` events.
   * 4. On success: parses JSON stdout, creates an `ssh_connections` row,
   *    verifies SSH connectivity, updates the instance to `ready`.
   * 5. On failure: updates the instance to `error`.
   *
   * Returns the instanceId immediately (non-blocking).
   */
  async provision(config: ProvisionConfig): Promise<string> {
    const instanceId = randomUUID();

    // Create the DB row before spawning so we can track the attempt.
    const { db } = await getDrizzleClient();
    await db.insert(workspaceInstances).values({
      id: instanceId,
      taskId: config.taskId,
      host: '', // placeholder until script returns
      status: 'provisioning',
      createdAt: Date.now(),
    });

    // Fire and forget — the caller listens for events.
    this.runProvision(instanceId, config).catch((err) => {
      log.error('[WorkspaceProvider] Unhandled provision error', { instanceId, error: err });
    });

    return instanceId;
  }

  /** Cancel an in-flight provision by killing the child process. */
  async cancel(instanceId: string): Promise<void> {
    const child = this.provisionProcesses.get(instanceId);
    if (child) {
      child.kill('SIGTERM');
      this.provisionProcesses.delete(instanceId);
    }
    await this.updateStatus(instanceId, 'error');
  }

  // ---------------------------------------------------------------------------
  // Terminate
  // ---------------------------------------------------------------------------

  /**
   * Runs the terminate script for a workspace instance.
   *
   * On success: updates the instance to `terminated` and deletes the
   * associated `ssh_connections` row.
   * On failure: updates the instance to `error` (rows kept for retry).
   */
  async terminate(config: TerminateConfig): Promise<void> {
    const instance = await this.getInstance(config.instanceId);
    if (!instance) {
      throw new Error(`Workspace instance ${config.instanceId} not found`);
    }

    const envVars: Record<string, string> = {
      EMDASH_INSTANCE_ID: instance.externalId || instance.host,
      EMDASH_TASK_ID: instance.taskId,
      ...(config.env ?? {}),
    };

    try {
      const stderrLines: string[] = [];
      const result = await this.runScript({
        command: config.terminateCommand,
        cwd: config.projectPath,
        envVars,
        timeoutMs: TERMINATE_TIMEOUT_MS,
        onStderr: (line) => stderrLines.push(line),
      });

      if (result.exitCode !== 0) {
        const logs = stderrLines.join('\n').trim();
        throw new Error(
          `Terminate script exited with code ${result.exitCode}` + (logs ? `:\n${logs}` : '')
        );
      }

      // Clean up the SSH connection row if one exists.
      if (instance.connectionId) {
        const { db } = await getDrizzleClient();
        await db.delete(sshConnections).where(eq(sshConnections.id, instance.connectionId));
      }

      await this.updateStatus(config.instanceId, 'terminated', Date.now());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('[WorkspaceProvider] Terminate failed', {
        instanceId: config.instanceId,
        error: message,
      });
      await this.updateStatus(config.instanceId, 'error');
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /** Get a workspace instance by ID. */
  async getInstance(instanceId: string): Promise<WorkspaceInstanceRow | null> {
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(workspaceInstances)
      .where(eq(workspaceInstances.id, instanceId))
      .limit(1);
    return rows[0] ?? null;
  }

  /** Get the active workspace instance for a task (provisioning or ready). */
  async getActiveInstance(taskId: string): Promise<WorkspaceInstanceRow | null> {
    const { db } = await getDrizzleClient();
    const rows = await db
      .select()
      .from(workspaceInstances)
      .where(
        and(
          eq(workspaceInstances.taskId, taskId),
          inArray(workspaceInstances.status, ['provisioning', 'ready'])
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  /** Get all workspace instances with a given status. */
  async getInstancesByStatus(
    status: 'provisioning' | 'ready' | 'terminated' | 'error'
  ): Promise<WorkspaceInstanceRow[]> {
    const { db } = await getDrizzleClient();
    return db.select().from(workspaceInstances).where(eq(workspaceInstances.status, status));
  }

  // ---------------------------------------------------------------------------
  // Reconnection (called on app startup)
  // ---------------------------------------------------------------------------

  /**
   * On app restart, mark any `provisioning` instances as `error` (the child
   * process is dead) and attempt to reconnect `ready` instances.
   */
  async reconcileOnStartup(): Promise<void> {
    // Mark stale provisioning attempts as errors.
    const stale = await this.getInstancesByStatus('provisioning');
    for (const instance of stale) {
      log.warn('[WorkspaceProvider] Marking stale provisioning instance as error', {
        instanceId: instance.id,
        taskId: instance.taskId,
      });
      await this.updateStatus(instance.id, 'error');
    }

    // Verify ready instances are still reachable.
    const ready = await this.getInstancesByStatus('ready');
    for (const instance of ready) {
      if (!instance.connectionId) {
        await this.updateStatus(instance.id, 'error');
        continue;
      }
      const connected = sshService.isConnected(instance.connectionId);
      if (!connected) {
        log.info('[WorkspaceProvider] Ready instance not connected, will need reconnection', {
          instanceId: instance.id,
          taskId: instance.taskId,
        });
        // Don't mark as error — the UI will show "reconnect" option.
        // The SSH connection will be re-established when the user opens the task.
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: provision flow
  // ---------------------------------------------------------------------------

  private async runProvision(instanceId: string, config: ProvisionConfig): Promise<void> {
    const envVars: Record<string, string> = {
      EMDASH_TASK_ID: config.taskId,
      EMDASH_REPO_URL: config.repoUrl,
      EMDASH_BRANCH: config.branch,
      EMDASH_BASE_REF: config.baseRef,
    };

    let stdout = '';
    let stderr = '';

    try {
      const result = await this.runScript({
        command: config.provisionCommand,
        cwd: config.projectPath,
        envVars,
        timeoutMs: PROVISION_TIMEOUT_MS,
        onStderr: (line) => {
          stderr += line;
          this.emit('provision-progress', { instanceId, line });
        },
        onStdout: (data) => {
          stdout += data;
        },
        trackProcess: (child) => {
          this.provisionProcesses.set(instanceId, child);
        },
      });

      // Clean up process tracking.
      this.provisionProcesses.delete(instanceId);

      if (result.exitCode !== 0) {
        throw new Error(
          `Provision script exited with code ${result.exitCode}.\n${stderr.slice(-500)}`
        );
      }

      // Parse the JSON output from stdout.
      const output = this.parseProvisionOutput(stdout);

      // Create an SSH connection row for this workspace.
      const connectionId = await this.createSshConnection(instanceId, output);

      // Update the workspace instance with the real data.
      const { db } = await getDrizzleClient();
      await db
        .update(workspaceInstances)
        .set({
          externalId: output.id ?? null,
          host: output.host,
          port: output.port ?? 22,
          username: output.username ?? null,
          worktreePath: output.worktreePath ?? null,
          connectionId,
        })
        .where(eq(workspaceInstances.id, instanceId));

      // Skip ssh2-based verification — the terminal uses system `ssh` which
      // reads ~/.ssh/config and the macOS keychain agent.  ssh2 cannot do
      // either, so verification would false-negative for SSH config aliases
      // and macOS agent-stored keys.  If SSH is actually unreachable the
      // user will see it fail in the terminal and can retry.
      await this.updateStatus(instanceId, 'ready');
      this.emit('provision-complete', { instanceId, status: 'ready' });
    } catch (err) {
      this.provisionProcesses.delete(instanceId);
      const message = err instanceof Error ? err.message : String(err);
      log.error('[WorkspaceProvider] Provision failed', { instanceId, error: message });
      await this.updateStatus(instanceId, 'error');
      this.emit('provision-complete', { instanceId, status: 'error', error: message });
    }
  }

  // ---------------------------------------------------------------------------
  // Internal: script runner
  // ---------------------------------------------------------------------------

  private runScript(opts: {
    command: string;
    cwd: string;
    envVars: Record<string, string>;
    timeoutMs: number;
    onStderr?: (line: string) => void;
    onStdout?: (data: string) => void;
    trackProcess?: (child: ChildProcess) => void;
  }): Promise<{ exitCode: number }> {
    return new Promise((resolve, reject) => {
      const env = { ...process.env, ...opts.envVars };

      const child = spawn('bash', ['-c', opts.command], {
        cwd: opts.cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      opts.trackProcess?.(child);

      let settled = false;
      const finish = (result: { exitCode: number } | Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (result instanceof Error) {
          reject(result);
        } else {
          resolve(result);
        }
      };

      const timer = setTimeout(() => {
        child.kill('SIGTERM');
        finish(new Error(`Script timed out after ${opts.timeoutMs / 1000}s`));
      }, opts.timeoutMs);

      child.stdout?.on('data', (buf: Buffer) => {
        opts.onStdout?.(buf.toString('utf-8'));
      });

      child.stderr?.on('data', (buf: Buffer) => {
        const text = buf.toString('utf-8');
        // Emit per-line for the UI.
        for (const line of text.split('\n')) {
          if (line.trim()) {
            opts.onStderr?.(line);
          }
        }
      });

      child.on('error', (err) => {
        finish(new Error(`Failed to spawn script: ${err.message}`));
      });

      child.on('exit', (code) => {
        finish({ exitCode: code ?? -1 });
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Internal: helpers
  // ---------------------------------------------------------------------------

  private parseProvisionOutput(stdout: string): ProvisionOutput {
    const trimmed = stdout.trim();
    if (!trimmed) {
      throw new Error('Provision script produced no output on stdout.');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new Error(
        'Provision script output is not valid JSON. ' +
          'Ensure all log output goes to stderr (>&2) and only JSON is printed to stdout.'
      );
    }

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw new Error('Provision script output must be a JSON object.');
    }

    const obj = parsed as Record<string, unknown>;

    if (typeof obj.host !== 'string' || !obj.host.trim()) {
      throw new Error(
        'Provision script output must include a "host" field (string). ' +
          'This can be a hostname, IP, or SSH config alias.'
      );
    }

    return {
      id: typeof obj.id === 'string' ? obj.id : undefined,
      host: obj.host.trim(),
      port: typeof obj.port === 'number' ? obj.port : undefined,
      username: typeof obj.username === 'string' ? obj.username : undefined,
      worktreePath: typeof obj.worktreePath === 'string' ? obj.worktreePath : undefined,
    };
  }

  private async createSshConnection(instanceId: string, output: ProvisionOutput): Promise<string> {
    const connectionId = `workspace-${instanceId}`;
    const { db } = await getDrizzleClient();
    const now = new Date().toISOString();

    await db.insert(sshConnections).values({
      id: connectionId,
      name: `workspace-${instanceId.slice(0, 8)}-${output.host}`,
      host: output.host,
      port: output.port ?? 22,
      username: output.username ?? process.env.USER ?? 'root',
      authType: 'agent',
      useAgent: 1,
      createdAt: now,
      updatedAt: now,
    });

    return connectionId;
  }

  private async updateStatus(
    instanceId: string,
    status: string,
    terminatedAt?: number
  ): Promise<void> {
    const { db } = await getDrizzleClient();
    const set: Record<string, unknown> = { status };
    if (terminatedAt !== undefined) {
      set.terminatedAt = terminatedAt;
    }
    await db.update(workspaceInstances).set(set).where(eq(workspaceInstances.id, instanceId));
  }
}

/** Module-level singleton. */
export const workspaceProviderService = new WorkspaceProviderService();
