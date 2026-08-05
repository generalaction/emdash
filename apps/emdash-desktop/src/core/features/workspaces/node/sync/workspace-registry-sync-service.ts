import { hostRefKey, isLocalHostRef, type HostRef } from '@emdash/core/primitives/host/api';
import {
  workspaceRecordsSchema,
  workspaceRegistryContract,
} from '@emdash/core/runtimes/workspace-registry/api';
import type { RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { createScope, type Scope } from '@emdash/shared/concurrency';
import { observe, remote } from '@emdash/wire';
import type { AppDb } from '@core/services/app-db/node/db';
import {
  applyWorkspaceRegistrySnapshot,
  type WorkspaceHostIdentity,
} from './apply-workspace-registry-snapshot';

export interface WorkspaceRegistrySyncServiceOptions {
  db: AppDb;
  runtimes: RuntimeBroker;
  scope?: Scope;
  onError?: (context: string, error: unknown) => void;
}

/**
 * Converges the desktop workspace mirror toward each reachable host's registry (ADR
 * 0005) by subscribing to that host's `records` live model. The replica delivers the
 * authoritative initial state and re-delivers the full map on every host change, and
 * every delivery routes through the same idempotent snapshot transaction — diffs are
 * never load-bearing on their own, since a reconnect replays full initial state.
 *
 * Reachability is positive-assertion: an unresolvable host client attaches nothing and
 * sweeps nothing; cached rows keep serving reads until the host comes back.
 */
export class WorkspaceRegistrySyncService {
  private readonly attachments = new Map<string, Scope>();
  private disposed = false;

  constructor(private readonly options: WorkspaceRegistrySyncServiceOptions) {
    options.scope?.add(() => this.dispose());
  }

  async attachHost(host: HostRef): Promise<void> {
    if (this.disposed) return;
    this.detachHost(host);
    const client = await this.options.runtimes.client(host);
    if (!client.success) return;
    const key = hostRefKey(host);
    if (this.disposed || this.attachments.has(key)) return;

    const scope = createScope({ label: `workspace-registry-sync:${key}` });
    this.attachments.set(key, scope);
    const records = remote(
      workspaceRegistryContract.records,
      client.data.workspaceRegistry.records,
      { scope }
    );
    const hostIdentity = hostIdentityFor(host);
    let chain = Promise.resolve();
    observe(
      records(undefined).states.list,
      (snapshot) => {
        if (snapshot.status === 'loading') return;
        const parsed = workspaceRecordsSchema.parse(snapshot.value ?? {});
        chain = chain
          .then(async () => {
            await applyWorkspaceRegistrySnapshot({
              db: this.options.db,
              host: hostIdentity,
              records: parsed,
            });
          })
          .catch((error) => {
            this.options.onError?.('workspace registry snapshot sync', error);
          });
      },
      { scope }
    );
  }

  detachHost(host: HostRef): void {
    const scope = this.attachments.get(hostRefKey(host));
    if (!scope) return;
    this.attachments.delete(hostRefKey(host));
    void scope.dispose();
  }

  dispose(): void {
    this.disposed = true;
    for (const scope of this.attachments.values()) {
      void scope.dispose();
    }
    this.attachments.clear();
  }
}

function hostIdentityFor(host: HostRef): WorkspaceHostIdentity {
  return isLocalHostRef(host)
    ? { location: 'local', sshConnectionId: null }
    : { location: 'remote', sshConnectionId: host.id };
}
