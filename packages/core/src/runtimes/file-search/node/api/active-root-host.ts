import type { Scope } from '@emdash/shared/concurrency';
import type { LeasedLiveModelProvider } from '@emdash/wire/rpc';
import { cell, derived, expose, snapshot, type Readable } from '@emdash/wire/state';
import {
  fileSearchContract,
  type ActiveRootAvailability,
  type ActiveRootStatus,
  type FileSearchRootInput,
} from '#runtimes/file-search/api';
import type { RootIndexStatus } from '../path/index/root-index';
import type { FileSearchRootRegistry } from '../root/root-registry';

export type ActiveRootHost = LeasedLiveModelProvider<typeof fileSearchContract.activeRoot>;

/**
 * Hosts the `activeRoot` live model: each keyed attachment holds one registry
 * lease, released when the record's scope is disposed (last detach, transport
 * disconnect, or provider disposal). `lingerMs: 0` keeps lease semantics exact
 * — the last release stops maintenance immediately, and reactivation is cheap
 * because cold generations stay searchable.
 */
export function createActiveRootHost(options: {
  registry: FileSearchRootRegistry;
  scope: Scope;
}): ActiveRootHost {
  return expose(
    fileSearchContract.activeRoot,
    { status: (key, scope) => resolveActiveRootStatus(options.registry, key, scope) },
    { scope: options.scope.child('active-root-host'), lingerMs: 0 }
  );
}

async function resolveActiveRootStatus(
  registry: FileSearchRootRegistry,
  key: FileSearchRootInput,
  scope: Scope
): Promise<Readable<ActiveRootStatus | undefined>> {
  const acquired = await registry.acquireRoot(key);
  if (!acquired.success) {
    return cell<ActiveRootStatus>({ phase: 'failed', error: acquired.error });
  }
  scope.add(() => acquired.data.release());
  const index = acquired.data.root.index;
  return derived(() => ({
    phase: 'active' as const,
    availability: toAvailability(snapshot(index.statusChanges).value),
    watcher: snapshot(index.watcherHealthChanges).value,
  }));
}

function toAvailability(status: RootIndexStatus): ActiveRootAvailability {
  switch (status.kind) {
    case 'building':
      return 'building';
    case 'ready':
      return 'searchable';
    case 'failed':
      return 'failed';
  }
}
