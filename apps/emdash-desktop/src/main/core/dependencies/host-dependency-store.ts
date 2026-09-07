import type {
  DependencyId,
  HostDependencySelection,
} from '@emdash/core/services/host-dependencies/node';
import type { Serializable } from '@emdash/shared';
import { desktopKeyValueStore } from '@main/db/kv';

const LOCAL_HOST_ID = 'local';
const STORE_PREFIX = 'host-dependencies';

/**
 * Persistence for host-scoped installation selections. Owned entirely by the
 * desktop app; the shared HostDependencyManager only reads selections through
 * its injected `getSelection` option.
 *
 * Stores InstallOverride | null (null = auto). Legacy {usedId,path?,cli?} values
 * are normalized on read via normalizeSelection.
 */
export interface IHostDependencyStore {
  getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null>;
  setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void>;
}

class HostDependencyStore implements IHostDependencyStore {
  async getSelection(hostId: string, depId: DependencyId): Promise<HostDependencySelection | null> {
    const result = await desktopKeyValueStore.get(storeKey(hostId));
    if (!result.success || result.data === null) return null;
    const doc = result.data as { selections?: Record<string, unknown> };
    return normalizeSelection(doc.selections?.[depId]);
  }

  async setSelection(
    hostId: string,
    depId: DependencyId,
    selection: HostDependencySelection
  ): Promise<void> {
    const result = await desktopKeyValueStore.get(storeKey(hostId));
    const doc =
      result.success && result.data && typeof result.data === 'object'
        ? (result.data as { version?: number; selections?: Record<string, unknown> })
        : {};
    const selections = { ...(doc.selections ?? {}) };
    if (selection === null) delete selections[depId];
    else selections[depId] = selection;
    await desktopKeyValueStore.set(storeKey(hostId), { version: 1, selections } as Serializable);
  }
}

export const hostDependencyStore = new HostDependencyStore();

function storeKey(hostId: string): string {
  return `${STORE_PREFIX}:${hostId || LOCAL_HOST_ID}:selections`;
}

function normalizeSelection(selection: unknown): HostDependencySelection | null {
  if (selection === null || selection === undefined) return null;
  if (typeof selection !== 'object') return null;
  const value = selection as {
    kind?: unknown;
    path?: unknown;
    realpath?: unknown;
    command?: unknown;
    usedId?: unknown;
  };
  if (value.kind === 'path' && typeof value.path === 'string') {
    return { kind: 'path', path: value.path };
  }
  if (value.kind === 'pinned' && typeof value.realpath === 'string') {
    return { kind: 'path', path: value.realpath };
  }
  if (value.kind === 'cli' && typeof value.command === 'string' && value.command.startsWith('/')) {
    return { kind: 'path', path: value.command };
  }
  if (typeof value.path === 'string') return { kind: 'path', path: value.path };
  return null;
}
