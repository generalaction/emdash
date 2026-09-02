import { normalizeExclusionPatterns } from '@emdash/core/primitives/exclusion-policy/api';
import type { HostRef } from '@emdash/core/primitives/host/api';
import {
  encodeResourceUri,
  hostFileRef,
  portableRelativePathBasename,
  resourceKeyFromFileRef,
  type HostAbsolutePath,
  type HostFileRef,
} from '@emdash/core/primitives/path/api';
import {
  PATH_SEARCH_DEFAULT_LIMIT,
  PATH_SEARCH_MAX_LIMIT,
  type PathSearchError,
} from '@emdash/core/runtimes/file-search/api';
import type { HostRuntimesClient, RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import type { Unsubscribe } from '@emdash/shared';
import { nativePathFromHost, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import type { WorkspaceFileHit } from '@core/primitives/search/api';
import { log } from '@main/lib/logger';

type FileSearchRuntimeClient = HostRuntimesClient['fileSearch'];

export type FileSearchRuntimeOptions = {
  getSearchExclusions(): Promise<readonly string[]>;
};

type ActiveRootLease = {
  readonly root: HostAbsolutePath;
  readonly host: HostRef;
  readonly exclusions: readonly string[];
  closed: boolean;
  pending: Promise<void> | undefined;
  detach: Unsubscribe | undefined;
};

type ActiveRootEntry = {
  readonly root: HostAbsolutePath;
  readonly host: HostRef;
  interests: number;
  desiredExclusions: readonly string[] | undefined;
  desiredExclusionsRevision: number;
  lease: ActiveRootLease | undefined;
  transition: Promise<void>;
};

export function createFileSearchRuntime(
  runtimes: Pick<RuntimeBroker, 'client'>,
  options: FileSearchRuntimeOptions
) {
  const activeRoots = new Map<string, ActiveRootEntry>();
  let exclusionsRevision = 0;

  const acquire = async (root: HostAbsolutePath, host: HostRef): Promise<void> => {
    const key = activeRootKey(root, host);
    let entry = activeRoots.get(key);
    if (!entry) {
      entry = {
        root,
        host,
        interests: 0,
        desiredExclusions: undefined,
        desiredExclusionsRevision: -1,
        lease: undefined,
        transition: Promise.resolve(),
      };
      activeRoots.set(key, entry);
    }
    entry.interests += 1;
    await enqueueReconcile(key, entry);
  };

  const release = async (root: HostAbsolutePath, host: HostRef): Promise<void> => {
    const key = activeRootKey(root, host);
    const entry = activeRoots.get(key);
    if (!entry) return;
    if (entry.interests <= 0) {
      await entry.transition;
      return;
    }
    entry.interests -= 1;
    if (entry.interests === 0 && entry.lease) entry.lease.closed = true;
    await enqueueReconcile(key, entry);
  };

  return {
    acquireRoot: acquire,
    releaseRoot: release,
    evictRoot: async (root: HostAbsolutePath, host: HostRef) => {
      await releaseAll(root, host);
      await evictFileSearchRoot(runtimes, root, host);
    },
    refreshExclusions: async () => {
      const revision = ++exclusionsRevision;
      const patterns = normalizeExclusionPatterns(await options.getSearchExclusions());
      await Promise.all(
        [...activeRoots].map(async ([key, entry]) => {
          if (activeRoots.get(key) !== entry || entry.interests <= 0) return;
          if (revision < entry.desiredExclusionsRevision) return;
          entry.desiredExclusions = patterns;
          entry.desiredExclusionsRevision = revision;
          await enqueueReconcile(key, entry);
        })
      );
    },
  };

  async function releaseAll(root: HostAbsolutePath, host: HostRef): Promise<void> {
    const key = activeRootKey(root, host);
    const entry = activeRoots.get(key);
    if (!entry) return;
    entry.interests = 0;
    if (entry.lease) entry.lease.closed = true;
    await enqueueReconcile(key, entry);
  }

  function enqueueReconcile(key: string, entry: ActiveRootEntry): Promise<void> {
    const reconcile = () => reconcileEntry(key, entry);
    const transition = entry.transition.then(reconcile, reconcile);
    entry.transition = transition;
    return transition;
  }

  async function reconcileEntry(key: string, entry: ActiveRootEntry): Promise<void> {
    if (entry.interests <= 0) {
      await closeCurrentLease(entry);
      if (entry.interests <= 0 && activeRoots.get(key) === entry) activeRoots.delete(key);
      return;
    }

    const exclusions = await resolveDesiredExclusions(entry);
    if (entry.interests <= 0 || activeRoots.get(key) !== entry) return;
    if (entry.lease && sameExclusions(entry.lease.exclusions, exclusions)) return;

    await closeCurrentLease(entry);
    if (entry.interests <= 0 || activeRoots.get(key) !== entry) return;

    const lease: ActiveRootLease = {
      root: entry.root,
      host: entry.host,
      exclusions,
      closed: false,
      pending: undefined,
      detach: undefined,
    };
    entry.lease = lease;
    lease.pending = attachLease(runtimes, lease);
    await lease.pending;
    if (!lease.detach && entry.lease === lease) entry.lease = undefined;
  }

  async function resolveDesiredExclusions(entry: ActiveRootEntry): Promise<readonly string[]> {
    if (entry.desiredExclusions) return entry.desiredExclusions;
    const revision = exclusionsRevision;
    const patterns = normalizeExclusionPatterns(await options.getSearchExclusions());
    if (!entry.desiredExclusions || entry.desiredExclusionsRevision <= revision) {
      entry.desiredExclusions = patterns;
      entry.desiredExclusionsRevision = revision;
    }
    return entry.desiredExclusions;
  }

  async function closeCurrentLease(entry: ActiveRootEntry): Promise<void> {
    const lease = entry.lease;
    if (!lease) return;
    entry.lease = undefined;
    await closeLease(lease);
  }
}

async function attachLease(
  runtimes: Pick<RuntimeBroker, 'client'>,
  lease: ActiveRootLease
): Promise<void> {
  try {
    const runtime = await runtimes.client(lease.host);
    if (!runtime.success) {
      log.warn('Failed to resolve file-search runtime', {
        host: lease.host,
        root: nativePathFromHost(lease.root),
        error: runtime.error,
      });
      return;
    }
    const detach = await runtime.data.fileSearch.activeRoot
      .state({ root: lease.root, exclusions: [...lease.exclusions] }, 'status')
      .attach(() => {}, {
        onReattachError: (error) => {
          log.warn('File-search root lease reattach failed', {
            host: lease.host,
            root: nativePathFromHost(lease.root),
            error: String(error),
          });
        },
      });
    if (lease.closed) {
      detach();
      return;
    }
    lease.detach = detach;
  } catch (error) {
    log.warn('File-search root lease attach threw unexpectedly', {
      host: lease.host,
      root: nativePathFromHost(lease.root),
      error: String(error),
    });
  }
}

async function closeLease(lease: ActiveRootLease): Promise<void> {
  lease.closed = true;
  await lease.pending;
  lease.detach?.();
  lease.detach = undefined;
}

async function evictFileSearchRoot(
  runtimes: Pick<RuntimeBroker, 'client'>,
  root: HostAbsolutePath,
  host: HostRef
): Promise<void> {
  try {
    const runtime = await runtimes.client(host);
    if (!runtime.success) {
      log.warn('Failed to resolve file-search runtime', { host, root, error: runtime.error });
      return;
    }
    const result = await runtime.data.fileSearch.evictRoot({ root });
    if (!result.success) {
      log.warn('Failed to evict file-search root', {
        host,
        root: nativePathFromHost(root),
        error: result.error,
      });
    }
  } catch (error) {
    log.warn('File-search root eviction threw unexpectedly', {
      host,
      root: nativePathFromHost(root),
      error: String(error),
    });
  }
}

export async function searchFileSearchRoot(
  client: FileSearchRuntimeClient,
  root: HostFileRef,
  query: string,
  limit?: number
): Promise<WorkspaceFileHit[]> {
  try {
    const result = await client.searchPaths({
      root: root.path,
      query,
      kinds: ['file'],
      limit: normalizeLimit(limit),
    });
    if (!result.success) {
      if (!isTransientSearchError(result.error)) {
        log.warn('Failed to search file paths', {
          root: nativePathFromHost(root.path),
          query,
          error: result.error,
        });
      }
      return [];
    }

    return result.data.hits.map((hit) => ({
      resource: encodeResourceUri(hostFileRef(root.host, resolveRelativePath(root.path, hit.path))),
      relativePath: hit.path,
      filename: portableRelativePathBasename(hit.path),
    }));
  } catch (error) {
    log.warn('File path search threw unexpectedly', {
      root: nativePathFromHost(root.path),
      query,
      error: String(error),
    });
    return [];
  }
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) return undefined;
  if (!Number.isSafeInteger(limit) || limit <= 0) return PATH_SEARCH_DEFAULT_LIMIT;
  return Math.min(limit, PATH_SEARCH_MAX_LIMIT);
}

function isTransientSearchError(error: PathSearchError): boolean {
  return error.type === 'index-not-ready' || error.type === 'root-not-registered';
}

function sameExclusions(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((pattern, index) => pattern === right[index]);
}

function activeRootKey(root: HostAbsolutePath, host: HostRef): string {
  return resourceKeyFromFileRef(hostFileRef(host, root));
}
