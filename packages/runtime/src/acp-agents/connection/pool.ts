import type { Client, SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  AcpProcessHandle,
  AcpProcessHost,
  InitializeFailedError,
  NormalizedEvent,
  SpawnFailedError,
} from '@emdash/core/acp';
import type { AcpAgentApi, IAcpBehavior } from '@emdash/core/agents/plugins';
import type { Lease, Result } from '@emdash/shared';
import { err, isErr, ok } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createManagedSource, type ManagedSource, type Scope } from '@emdash/wire/util';
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
}

export type ConnectionPoolError = SpawnFailedError | InitializeFailedError;

export interface AcquiredConnection {
  entry: ConnectionPoolEntry;
  lease: Lease<ConnectionPoolEntry>;
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
  private readonly source: ManagedSource<string, PooledProcess>;
  private readonly inputs = new Map<string, AcquireConnectionInput>();

  constructor(private readonly deps: ConnectionPoolDeps) {
    this.source = createManagedSource({
      key: (key: string) => key,
      create: async (key, scope) => {
        const input = this.inputs.get(key);
        if (!input) throw new Error(`ConnectionPool: missing acquire input for '${key}'`);
        return this.provision(key, input, scope);
      },
      onError: (error, key) => {
        this.deps.logger.warn('ConnectionPool: provisioning failed', {
          key,
          error: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }

  makeKey(providerId: string, workspaceId: string): string {
    return `${providerId}:${workspaceId}`;
  }

  async acquire(
    input: AcquireConnectionInput
  ): Promise<Result<AcquiredConnection, ConnectionPoolError>> {
    const key = this.makeKey(input.providerId, input.workspaceId);
    this.inputs.set(key, input);

    try {
      const pending = this.source.acquire(key);
      const process = await pending.ready();
      const entry = this.entry(process);
      const lease: Lease<ConnectionPoolEntry> = {
        value: entry,
        release: pending.release,
      };
      return ok({ entry, lease });
    } catch (error) {
      if (isConnectionPoolError(error)) return err(error);
      throw error;
    }
  }

  get(key: string): ConnectionPoolEntry | null {
    const process = this.source.peek(key);
    return process ? this.entry(process) : null;
  }

  forgetClosed(key: string): Promise<void> {
    return this.source.invalidate(key);
  }

  dispose(): Promise<void> {
    return this.source.dispose();
  }

  private async provision(
    key: string,
    input: AcquireConnectionInput,
    scope: Scope
  ): Promise<PooledProcess> {
    const connection = await createAcpAgentConnection(
      { host: this.deps.host, behavior: input.behavior, logger: this.deps.logger },
      {
        providerId: input.providerId,
        cwd: input.cwd,
        buildClient: (agent) => input.buildClient(agent, key),
        onClosed: () => {
          const process = this.source.peek(key);
          this.deps.onClosed(key, process?.handle.exitCode ?? null);
        },
      }
    );
    if (isErr(connection)) throw connection.error;

    scope.add(() => {
      try {
        connection.data.handle.kill('SIGTERM');
      } catch {
        // ignore process teardown errors
      }
    });

    const capabilities = await connection.data.initialized;
    if (isErr(capabilities)) throw capabilities.error;

    return {
      key,
      providerId: input.providerId,
      workspaceId: input.workspaceId,
      cwd: input.cwd,
      handle: connection.data.handle,
      agent: connection.data.agent,
      normalize: connection.data.normalize,
      supportsLoadSession: capabilities.data.supportsLoadSession,
    };
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

function isConnectionPoolError(error: unknown): error is ConnectionPoolError {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === 'spawn_failed' || type === 'initialize_failed';
}
