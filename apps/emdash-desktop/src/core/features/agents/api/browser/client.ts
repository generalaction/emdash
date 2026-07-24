import { hostRef, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { RuntimeResolveError } from '@emdash/core/services/runtime-broker/api';
import type { Result } from '@emdash/shared';
import {
  getDesktopWireClient,
  type DesktopWireClient,
} from '@renderer/lib/runtime/desktop-wire-client';

export type AgentsRpcClient = DesktopWireClient['agents'];

export async function getAgentsClient(): Promise<AgentsRpcClient> {
  return (await getDesktopWireClient()).agents;
}

export async function unwrapAgentsResult<T>(
  result: Promise<Result<T, RuntimeResolveError>>
): Promise<T> {
  const resolved = await result;
  if (!resolved.success) throw resolved.error;
  return resolved.data;
}

export function hostRefFromConnectionId(connectionId?: string): HostRef {
  return connectionId ? hostRef('remote', connectionId) : LOCAL_HOST_REF;
}
