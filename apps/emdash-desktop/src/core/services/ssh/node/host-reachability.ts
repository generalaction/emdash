import {
  isLocalHostRef,
  parseHostRef,
  sshConnectionIdOf,
  type SerializedHostRef,
} from '@emdash/core/primitives/host/api';

/**
 * Synchronous host-reachability check backed by the SSH connection state: the local
 * host is always reachable; a remote host is reachable while its SSH connection is
 * up. Used to fail creation-side flows fast against offline hosts (ADR 0005 verbs
 * are plain fail-fast RPCs); deletion flows never consult it — they tombstone and
 * let the reconcile sweep converge (ADR 0006).
 */
export type HostReachabilityProbe = (hostRef: SerializedHostRef) => boolean;

export function createHostReachabilityProbe(ssh: {
  isConnected(connectionId: string): boolean;
}): HostReachabilityProbe {
  return (hostRef) => {
    const parsed = parseHostRef(hostRef);
    if (isLocalHostRef(parsed)) return true;
    const connectionId = sshConnectionIdOf(parsed);
    return connectionId !== undefined && ssh.isConnected(connectionId);
  };
}
