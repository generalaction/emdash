import type { Client } from '@agentclientprotocol/sdk';
import { isErr, toSerializedError } from '@emdash/shared';
import type { Logger } from '@emdash/shared/logger';
import { createResourceCache, type ResourceCache, type Scope } from '@emdash/wire/util';
import type { AcpProcessHost } from '@runtimes/acp/api';
import { acpErr } from '@runtimes/acp/api';
import type {
  AcpAgentApi,
  AgentHostError,
  AgentPluginHost,
} from '@services/agent-plugins/api/plugins';
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
  buildClient: (agent: AcpAgentApi, context: AcpConnectionContext) => Client;
  onClosed: (key: string, exitCode: number | null) => void;
}

export interface AcpConnectionKey {
  providerId: string;
  workspaceId: string;
  cwd: string;
}

export type AcpConnectionSource = ResourceCache<AcpConnectionKey, PooledAcpProcess>;

export function createAcpConnectionSource(
  deps: CreateAcpConnectionSourceDeps
): AcpConnectionSource {
  const source: AcpConnectionSource = createResourceCache<AcpConnectionKey, PooledAcpProcess>({
    key: acpConnectionCacheKey,
    create: (key, scope) => provisionAcpConnection(deps, key, scope),
    onError: (error, keyId) => {
      deps.logger.warn('AcpConnectionSource: provisioning failed', {
        key: keyId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  return source;
}

export function makeAcpConnectionKey(providerId: string, workspaceId: string): string {
  return `${providerId}:${workspaceId}`;
}

export function acpConnectionCacheKey(key: AcpConnectionKey): string {
  return `${makeAcpConnectionKey(key.providerId, key.workspaceId)}:${key.cwd}`;
}

export function isAcpConnectionError(error: unknown): error is AcpConnectionError {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === 'spawn_failed' || type === 'initialize_failed';
}

async function provisionAcpConnection(
  deps: CreateAcpConnectionSourceDeps,
  key: AcpConnectionKey,
  scope: Scope
): Promise<PooledAcpProcess> {
  const binding = deps.agentHost.resolveAcp(key.providerId);
  if (!binding) {
    throw acpErr.spawnFailed(
      toSerializedError(new Error(`Provider '${key.providerId}' does not support ACP`))
    ).error;
  }

  const routeKey = makeAcpConnectionKey(key.providerId, key.workspaceId);
  const spawn = await deps.agentHost.buildAcpSpawn(key.providerId, { cwd: key.cwd });
  if (!spawn.success) {
    throw acpErr.spawnFailed(toSerializedError(new Error(agentHostErrorMessage(spawn.error))))
      .error;
  }

  const connection = await createAcpAgentConnection(
    {
      host: deps.host,
      behavior: binding.behavior,
      logger: deps.logger,
    },
    {
      providerId: key.providerId,
      spawn: spawn.data,
      scope,
      buildClient: (agent, normalize) =>
        deps.buildClient(agent, {
          key: routeKey,
          providerId: key.providerId,
          workspaceId: key.workspaceId,
          cwd: key.cwd,
          normalize,
        }),
      onClosed: (exitCode) => deps.onClosed(routeKey, exitCode),
    }
  );
  if (isErr(connection)) throw connection.error;

  return {
    key: routeKey,
    providerId: key.providerId,
    workspaceId: key.workspaceId,
    cwd: key.cwd,
    agent: connection.data.agent,
    normalize: connection.data.normalize,
    supportsLoadSession: connection.data.supportsLoadSession,
  };
}

function agentHostErrorMessage(error: AgentHostError): string {
  return 'message' in error ? error.message : error.type;
}
