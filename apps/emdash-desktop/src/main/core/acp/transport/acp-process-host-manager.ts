import { machineKey, type MachineRef } from '@main/core/runtime/types';
import { sshConnectionManager } from '@main/core/ssh/lifecycle/production-ssh-connection-manager';
import { LegacySshAcpProcessHost } from './legacy-ssh-acp-process-host';
import { LocalAcpProcessHost } from './local-acp-process-host';
import type { AcpProcessHost, AcpProcessHostManager } from './types';

/**
 * Standalone singleton that maps a MachineRef to an AcpProcessHost.
 *
 * - `local` → shared LocalAcpProcessHost instance (spawns node:child_process).
 * - `ssh:<connectionId>` → LegacySshAcpProcessHost built from the live
 *   SshClientProxy returned by sshConnectionManager.connect(connectionId).
 *   SSH process hosts are cached per connection id for the lifetime of the
 *   manager; the underlying SSH proxy handles reconnects transparently.
 */
class AcpProcessHostManagerImpl implements AcpProcessHostManager {
  private readonly localHost = new LocalAcpProcessHost();
  private readonly sshHosts = new Map<string, LegacySshAcpProcessHost>();

  async get(machine: MachineRef): Promise<AcpProcessHost> {
    const key = machineKey(machine);

    if (machine.kind === 'local') {
      return this.localHost;
    }

    const cached = this.sshHosts.get(key);
    if (cached) return cached;

    const proxy = await sshConnectionManager.connect(machine.connectionId);
    const host = new LegacySshAcpProcessHost(proxy);
    this.sshHosts.set(key, host);
    return host;
  }
}

export const acpProcessHostManager: AcpProcessHostManager = new AcpProcessHostManagerImpl();
