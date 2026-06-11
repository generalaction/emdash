import { eq } from 'drizzle-orm';
import { mergeDependencySelection } from '@main/core/ssh/config/connection-metadata';
import { db } from '@main/db/client';
import { KV } from '@main/db/kv';
import { sshConnections } from '@main/db/schema';
import { log } from '@main/lib/logger';
import type { DependencyId } from '@shared/core/dependencies';
import type { HostDependencySelection } from '@shared/core/dependencies';
import { sshConnectionMetadata } from '@shared/core/ssh/ssh-connection-metadata';

const LOCAL_HOST_ID = 'local';

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

export interface IHostDependencyStore {
  getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null>;
  setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void>;
}

// ---------------------------------------------------------------------------
// Local store (KV table)
// ---------------------------------------------------------------------------

type LocalHostDepKV = {
  selections: Record<string, HostDependencySelection>;
};

class LocalHostDependencyStore implements IHostDependencyStore {
  private readonly kv = new KV<LocalHostDepKV>('host-dep');

  async getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null> {
    if (hostId !== LOCAL_HOST_ID) return null;
    const all = await this.kv.get('selections');
    return all?.[depId] ?? null;
  }

  async setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void> {
    if (hostId !== LOCAL_HOST_ID) return;
    const all = (await this.kv.get('selections')) ?? {};
    all[depId] = selection;
    await this.kv.set('selections', all);
  }
}

// ---------------------------------------------------------------------------
// SSH store (sshConnections.metadata column)
// ---------------------------------------------------------------------------

class SshHostDependencyStore implements IHostDependencyStore {
  async getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null> {
    if (hostId === LOCAL_HOST_ID) return null;
    try {
      const [row] = await db
        .select({ metadata: sshConnections.metadata })
        .from(sshConnections)
        .where(eq(sshConnections.id, hostId))
        .limit(1);
      return row?.metadata?.dependencySelections?.[depId] ?? null;
    } catch (err) {
      log.warn('[SshHostDependencyStore] Failed to read dependency selection', {
        hostId,
        depId,
        error: err,
      });
      return null;
    }
  }

  async setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void> {
    if (hostId === LOCAL_HOST_ID) return;
    try {
      const [row] = await db
        .select({ metadata: sshConnections.metadata })
        .from(sshConnections)
        .where(eq(sshConnections.id, hostId))
        .limit(1);

      if (!row) {
        log.warn('[SshHostDependencyStore] SSH connection not found', { hostId });
        return;
      }

      const existing = row.metadata ?? {};
      const updated = mergeDependencySelection(existing, depId, selection);
      const serialized = sshConnectionMetadata.serialize(updated);

      await db
        .update(sshConnections)
        .set({ metadata: updated, updatedAt: new Date().toISOString() })
        .where(eq(sshConnections.id, hostId));

      log.debug('[SshHostDependencyStore] Saved dependency selection', {
        hostId,
        depId,
        serialized,
      });
    } catch (err) {
      log.warn('[SshHostDependencyStore] Failed to save dependency selection', {
        hostId,
        depId,
        error: err,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Combined store — routes local vs SSH automatically
// ---------------------------------------------------------------------------

class HostDependencyStore implements IHostDependencyStore {
  private readonly local = new LocalHostDependencyStore();
  private readonly ssh = new SshHostDependencyStore();

  private storeFor(hostId: string): IHostDependencyStore {
    return hostId === LOCAL_HOST_ID ? this.local : this.ssh;
  }

  getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null> {
    return this.storeFor(hostId).getSelection(hostId, depId);
  }

  setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void> {
    return this.storeFor(hostId).setSelection(hostId, depId, selection);
  }
}

export const hostDependencyStore = new HostDependencyStore();
