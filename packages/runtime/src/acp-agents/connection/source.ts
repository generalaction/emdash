import type { Client } from '@agentclientprotocol/sdk';
import type { AcpProcessHost } from '@emdash/core/acp';
import { acpErr } from '@emdash/core/acp';
import type {
  AcpAgentApi,
  AgentHostError,
  AgentPluginHost,
  IAcpBehavior,
} from '@emdash/core/agents/plugins';
import { isErr, toSerializedError } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createManagedSource, type ManagedSource, type Scope } from '@emdash/wire/util';
import {
  createAcpAgentConnection,
  type AcpConnectionError,
  type AcpSessionUpdateNormalizer,
} from './acp-agent-connection';

type AcpConnectionProcessHost = Pick<AcpProcessHost, 'spawn' | 'spawnTerminal'>;

export interface AcpConnectionContext {
  key: string;
  providerId: string;
  workspaceId: string;
  cwd: string;
  normalize: AcpSessionUpdateNormalizer;
}

export interface AcpConnectionEntry extends AcpConnectionContext {
  agent: AcpAgentApi;
  supportsLoadSession: boolean;
}

export type PooledAcpProcess = AcpConnectionEntry;

export interface CreateAcpConnectionSourceDeps {
  host: AcpConnectionProcessHost;
  agentHost: AgentPluginHost;
  logger: Logger;
  onClosed: (key: string, exitCode: number | null) => void;
}

export interface AcquireAcpConnectionInput {
  providerId: string;
  workspaceId: string;
  cwd: string;
  behavior: IAcpBehavior;
  buildClient: (agent: AcpAgentApi, context: AcpConnectionContext) => Client;
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
    create: (key, input, scope) => provisionAcpConnection(deps, key, input, scope),
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

export function isAcpConnectionError(error: unknown): error is AcpConnectionError {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === 'spawn_failed' || type === 'initialize_failed';
}

async function provisionAcpConnection(
  deps: CreateAcpConnectionSourceDeps,
  key: string,
  input: AcquireAcpConnectionInput,
  scope: Scope
): Promise<PooledAcpProcess> {
  const spawn = await deps.agentHost.buildAcpSpawn(input.providerId, { cwd: input.cwd });
  if (!spawn.success) {
    throw acpErr.spawnFailed(toSerializedError(new Error(agentHostErrorMessage(spawn.error))))
      .error;
  }

  const connection = await createAcpAgentConnection(
    {
      host: deps.host,
      behavior: input.behavior,
      logger: deps.logger,
    },
    {
      providerId: input.providerId,
      spawn: spawn.data,
      scope,
      buildClient: (agent, normalize) =>
        input.buildClient(agent, {
          key,
          providerId: input.providerId,
          workspaceId: input.workspaceId,
          cwd: input.cwd,
          normalize,
        }),
      onClosed: (exitCode) => deps.onClosed(key, exitCode),
    }
  );
  if (isErr(connection)) throw connection.error;

  return {
    key,
    providerId: input.providerId,
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    agent: connection.data.agent,
    normalize: connection.data.normalize,
    supportsLoadSession: connection.data.supportsLoadSession,
  };
}

function agentHostErrorMessage(error: AgentHostError): string {
  return 'message' in error ? error.message : error.type;
}
