import { hostRefEquals, LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import type { Hosts } from './hosts';

/** Language services are included in protocol 12.0, enforced by the connection handshake. */
export async function hostSupportsLsp(host: HostRef, hosts: Hosts): Promise<boolean> {
  if (hostRefEquals(host, LOCAL_HOST_REF)) return true;
  const service = hosts.get(host);
  if (!service) return false;
  const connection = await service.runtime.client({ waitForReady: false });
  return connection.currentHandshake() !== undefined;
}
