import { hostRefEquals, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { Hosts } from './hosts';

/** LSP was added in workspace protocol 11.1; compatible older servers omit it. */
export async function hostSupportsLsp(host: HostRef, hosts: Hosts): Promise<boolean> {
  if (hostRefEquals(host, LOCAL_HOST_REF)) return true;
  const service = hosts.get(host);
  if (!service) return false;
  const connection = await service.runtime.client({ waitForReady: false });
  const handshake = connection.currentHandshake();
  return handshake !== undefined && handshake.agreedMinor >= 1;
}
