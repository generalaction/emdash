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

export function createFileSearchRuntime(
  runtimes: Pick<RuntimeBroker, 'client'>,
  options: FileSearchRuntimeOptions
) {
  const activeLeases = new Map<string, ActiveRootLease>();

  const acquire = async (root: HostAbsolutePath, host: HostRef): Promise<void> => {
    const key = activeRootKey(root, host);
    if (activeLeases.has(key)) return;
    const lease: ActiveRootLease = {
      root,
      host,
      exclusions: normalizeExclusionPatterns(await options.getSearchExclusions()),
      closed: false,
      pending: undefined,
      detach: undefined,
    };
    activeLeases.set(key, lease);
    lease.pending = attachLease(runtimes, lease);
    await lease.pending;
  };

  const release = async (root: HostAbsolutePath, host: HostRef): Promise<void> => {
    const key = activeRootKey(root, host);
    const lease = activeLeases.get(key);
    if (!lease) return;
    activeLeases.delete(key);
    await closeLease(lease);
  };

  return {
    acquireRoot: acquire,
    releaseRoot: release,
    evictRoot: async (root: HostAbsolutePath, host: HostRef) => {
      await release(root, host);
      await evictFileSearchRoot(runtimes, root, host);
    },
    refreshExclusions: async () => {
      const patterns = normalizeExclusionPatterns(await options.getSearchExclusions());
      for (const [key, lease] of [...activeLeases]) {
        if (activeLeases.get(key) !== lease) continue;
        if (sameExclusions(lease.exclusions, patterns)) continue;
        await closeLease(lease);
        const fresh: ActiveRootLease = {
          root: lease.root,
          host: lease.host,
          exclusions: patterns,
          closed: false,
          pending: undefined,
          detach: undefined,
        };
        activeLeases.set(key, fresh);
        fresh.pending = attachLease(runtimes, fresh);
        await fresh.pending;
      }
    },
  };
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
