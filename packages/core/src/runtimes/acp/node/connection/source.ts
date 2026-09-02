import { createHash } from 'node:crypto';
import type { Client, McpCapabilities } from '@agentclientprotocol/sdk';
import { isErr, toSerializedError } from '@emdash/shared';
import { createResourceCache, type ResourceCache, type Scope } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type { Clock } from '@emdash/shared/scheduling';
import { nativePathIdentityKey } from '#primitives/path/api';
import { acpErr } from '#runtimes/acp/api';
import type { AcpProcessHost } from '#runtimes/acp/api/transport';
import type {
  AcpAgentApi,
  AgentHostError,
  AgentPluginHost,
} from '#services/agent-plugins/api/plugins';
import {
  createAcpAgentConnection,
  type AcpConnectionError,
  type AcpSessionUpdateNormalizer,
} from './acp-agent-connection';

type AcpConnectionProcessHost = Pick<AcpProcessHost, 'spawn' | 'spawnTerminal'>;

export interface AcpConnectionContext {
  key: string;
  generation: number;
  providerId: string;
  cwd: string;
  env: Readonly<Record<string, string>>;
  normalize: AcpSessionUpdateNormalizer;
}

export interface AcpConnectionEntry extends AcpConnectionContext {
  agent: AcpAgentApi;
  supportsLoadSession: boolean;
  mcpCapabilities: Required<Pick<McpCapabilities, 'http' | 'sse'>>;
}

export type PooledAcpProcess = AcpConnectionEntry;

export interface CreateAcpConnectionSourceDeps {
  host: AcpConnectionProcessHost;
  agentHost: AgentPluginHost;
  logger: Logger;
  clock?: Clock;
  idleTtlMs?: number;
  buildClient: (agent: AcpAgentApi, context: AcpConnectionContext) => Client;
  onClosed: (key: string, generation: number, exitCode: number | null) => void;
}

export interface AcpConnectionKey {
  providerId: string;
  cwd: string;
  env?: Record<string, string>;
}

export type AcpConnectionSource = ResourceCache<AcpConnectionKey, PooledAcpProcess>;

export function createAcpConnectionSource(
  deps: CreateAcpConnectionSourceDeps
): AcpConnectionSource {
  let nextGeneration = 0;
  const source: AcpConnectionSource = createResourceCache<AcpConnectionKey, PooledAcpProcess>({
    key: acpConnectionCacheKey,
    clock: deps.clock,
    idleTtlMs: deps.idleTtlMs,
    create: (key, scope) => provisionAcpConnection(deps, key, ++nextGeneration, scope),
    onError: (error, keyId) => {
      deps.logger.warn('AcpConnectionSource: provisioning failed', {
        key: keyId,
        error: error instanceof Error ? error.message : String(error),
      });
    },
  });
  return source;
}

export function makeAcpConnectionKey(providerId: string, cwd: string): string {
  return `${providerId}:${nativePathIdentityKey(cwd)}`;
}

export function acpConnectionCacheKey(key: AcpConnectionKey): string {
  const envFingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        Object.entries(key.env ?? {}).sort(([left], [right]) => left.localeCompare(right))
      )
    )
    .digest('hex');
  return `${makeAcpConnectionKey(key.providerId, key.cwd)}:env:${envFingerprint}`;
}

export function isAcpConnectionError(error: unknown): error is AcpConnectionError {
  if (typeof error !== 'object' || error === null) return false;
  const type = (error as { type?: unknown }).type;
  return type === 'spawn_failed' || type === 'initialize_failed';
}

async function provisionAcpConnection(
  deps: CreateAcpConnectionSourceDeps,
  key: AcpConnectionKey,
  generation: number,
  scope: Scope
): Promise<PooledAcpProcess> {
  const binding = deps.agentHost.resolveAcp(key.providerId);
  if (!binding) {
    throw acpErr.spawnFailed(
      toSerializedError(new Error(`Provider '${key.providerId}' does not support ACP`))
    ).error;
  }

  const routeKey = makeAcpConnectionKey(key.providerId, key.cwd);
  const spawn = await deps.agentHost.buildAcpSpawn(key.providerId, {
    cwd: key.cwd,
    env: key.env,
  });
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
          generation,
          providerId: key.providerId,
          cwd: key.cwd,
          env: spawn.data.env,
          normalize,
        }),
      onClosed: (exitCode) => deps.onClosed(routeKey, generation, exitCode),
    }
  );
  if (isErr(connection)) throw connection.error;

  return {
    key: routeKey,
    generation,
    providerId: key.providerId,
    cwd: key.cwd,
    env: spawn.data.env,
    agent: connection.data.agent,
    normalize: connection.data.normalize,
    supportsLoadSession: connection.data.supportsLoadSession,
    mcpCapabilities: connection.data.mcpCapabilities,
  };
}

function agentHostErrorMessage(error: AgentHostError): string {
  return 'message' in error ? error.message : error.type;
}
