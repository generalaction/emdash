import type { Client, SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  AcpProcessHandle,
  AcpProcessHost,
  AcpRuntimeError,
  NormalizedEvent,
} from '@emdash/core/acp';
import type { AcpAgentApi, IAcpBehavior } from '@emdash/core/agents/plugins';
import type { Result } from '@emdash/shared';
import { isErr, LifecycleMap, ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createAcpAgentConnection } from './acp-agent-connection';

export interface ConnectionPoolEntry {
  key: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  agent: AcpAgentApi;
  normalize: (raw: SessionUpdate) => NormalizedEvent;
  supportsLoadSession: boolean;
}

interface PooledProcess extends ConnectionPoolEntry {
  handle: AcpProcessHandle;
  refCount: number;
}

export interface ConnectionPoolDeps {
  host: AcpProcessHost;
  logger: Logger;
  onClosed: (key: string, exitCode: number | null) => void;
}

export interface AcquireConnectionInput {
  providerId: string;
  workspaceId: string;
  cwd: string;
  behavior: IAcpBehavior;
  buildClient: (agent: AcpAgentApi, key: string) => Client;
}

export class ConnectionPool {
  private readonly processes = new LifecycleMap<PooledProcess, AcpRuntimeError, void>();

  constructor(private readonly deps: ConnectionPoolDeps) {}

  makeKey(providerId: string, workspaceId: string): string {
    return `${providerId}:${workspaceId}`;
  }

  async acquire(
    input: AcquireConnectionInput
  ): Promise<Result<ConnectionPoolEntry, AcpRuntimeError>> {
    const key = this.makeKey(input.providerId, input.workspaceId);
    const result = await this.processes.provision(key, () => this.provision(key, input));
    if (isErr(result)) return result;

    result.data.refCount += 1;
    return ok(this.entry(result.data));
  }

  get(key: string): ConnectionPoolEntry | null {
    const process = this.processes.get(key);
    return process ? this.entry(process) : null;
  }

  release(key: string): void {
    const process = this.processes.get(key);
    if (!process) return;

    process.refCount = Math.max(0, process.refCount - 1);
    if (process.refCount > 0) return;
    this.teardown(key, process);
  }

  teardownNow(key: string): void {
    const process = this.processes.get(key);
    if (!process) return;
    this.teardown(key, process);
  }

  forgetClosed(key: string): void {
    this.processes.teardown(key, async () => ok());
  }

  private async provision(
    key: string,
    input: AcquireConnectionInput
  ): Promise<Result<PooledProcess, AcpRuntimeError>> {
    const connection = await createAcpAgentConnection(
      { host: this.deps.host, behavior: input.behavior, logger: this.deps.logger },
      {
        providerId: input.providerId,
        cwd: input.cwd,
        buildClient: (agent) => input.buildClient(agent, key),
        onClosed: () => {
          const process = this.processes.get(key);
          this.deps.onClosed(key, process?.handle.exitCode ?? null);
        },
      }
    );
    if (isErr(connection)) return connection;

    const capabilities = await connection.data.initialized;
    if (isErr(capabilities)) return capabilities;

    return ok({
      key,
      providerId: input.providerId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      handle: connection.data.handle,
      agent: connection.data.agent,
      normalize: connection.data.normalize,
      supportsLoadSession: capabilities.data.supportsLoadSession,
      refCount: 0,
    });
  }

  private teardown(key: string, process: PooledProcess): void {
    try {
      process.handle.kill('SIGTERM');
    } catch {
      // ignore process teardown errors
    }
    this.processes.teardown(key, async () => ok());
  }

  private entry(process: PooledProcess): ConnectionPoolEntry {
    return {
      key: process.key,
      providerId: process.providerId,
      workspaceId: process.workspaceId,
      cwd: process.cwd,
      agent: process.agent,
      normalize: process.normalize,
      supportsLoadSession: process.supportsLoadSession,
    };
  }
}
