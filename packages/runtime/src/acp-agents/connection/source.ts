import type { Client, SessionUpdate } from '@agentclientprotocol/sdk';
import type {
  AcpProcessHandle,
  AcpProcessHost,
  InitializeFailedError,
  NormalizedEvent,
  SpawnFailedError,
} from '@emdash/core/acp';
import type { AcpAgentApi, IAcpBehavior } from '@emdash/core/agents/plugins';
import type { SpawnContextResolver } from '@emdash/core/agents/spawn-context';
import { isErr } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createManagedSource, type ManagedSource, type Scope } from '@emdash/wire/util';
import { createAcpAgentConnection } from './acp-agent-connection';

type AcpConnectionProcessHost = Pick<AcpProcessHost, 'spawn' | 'spawnTerminal'>;

export interface AcpConnectionEntry {
  key: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  agent: AcpAgentApi;
  normalize: (raw: SessionUpdate) => NormalizedEvent;
  supportsLoadSession: boolean;
}

export interface PooledAcpProcess extends AcpConnectionEntry {
  handle: AcpProcessHandle;
}

export type AcpConnectionError = SpawnFailedError | InitializeFailedError;

export interface CreateAcpConnectionSourceDeps {
  host: AcpConnectionProcessHost;
  spawnContext: SpawnContextResolver;
  logger: Logger;
  onClosed: (key: string, exitCode: number | null) => void;
}

export interface AcquireAcpConnectionInput {
  providerId: string;
  workspaceId: string;
  cwd: string;
  behavior: IAcpBehavior;
  buildClient: (agent: AcpAgentApi, key: string) => Client;
}

export type AcpConnectionSource = ManagedSource<
  string,
  PooledAcpProcess,
  AcquireAcpConnectionInput
>;

export function createAcpConnectionSource(
  deps: CreateAcpConnectionSourceDeps
): AcpConnectionSource {
  const source: AcpConnectionSource = createManagedSource<
    string,
    PooledAcpProcess,
    AcquireAcpConnectionInput
  >({
    key: (key) => key,
    create: (key, input, scope) => provisionAcpConnection(deps, source, key, input, scope),
    onError: (error, key) => {
      deps.logger.warn('AcpConnectionSource: provisioning failed', {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  return source;
}

export function makeAcpConnectionKey(providerId: string, workspaceId: string): string {
  return `${providerId}:${workspaceId}`;
}

export function projectAcpConnectionEntry(process: PooledAcpProcess): AcpConnectionEntry;
export function projectAcpConnectionEntry(
  process: PooledAcpProcess | undefined
): AcpConnectionEntry | null;
export function projectAcpConnectionEntry(
  process: PooledAcpProcess | undefined
): AcpConnectionEntry | null {
  if (!process) return null;
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

export function isAcpConnectionError(error: unknown): error is AcpConnectionError {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === 'spawn_failed' || type === 'initialize_failed';
}

async function provisionAcpConnection(
  deps: CreateAcpConnectionSourceDeps,
  source: AcpConnectionSource,
  key: string,
  input: AcquireAcpConnectionInput,
  scope: Scope
): Promise<PooledAcpProcess> {
  const connection = await createAcpAgentConnection(
    {
      host: deps.host,
      spawnContext: deps.spawnContext,
      behavior: input.behavior,
      logger: deps.logger,
    },
    {
      providerId: input.providerId,
      cwd: input.cwd,
      buildClient: (agent) => input.buildClient(agent, key),
      onClosed: () => {
        const process = source.peek(key);
        deps.onClosed(key, process?.handle.exitCode ?? null);
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
