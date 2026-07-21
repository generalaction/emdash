import { LOCAL_HOST_REF, type HostRef } from '@emdash/core/primitives/host/api';
import {
  portableRelativePathBasename,
  type HostAbsolutePath,
} from '@emdash/core/primitives/path/api';
import {
  PATH_SEARCH_DEFAULT_LIMIT,
  PATH_SEARCH_MAX_LIMIT,
  type PathSearchError,
} from '@emdash/core/runtimes/file-search/api';
import type { HostRuntimesClient, RuntimeBroker } from '@emdash/core/services/runtime-broker/api';
import { nativePathFromHost, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import type { WorkspaceFileHit } from '@core/primitives/search/api';
import { log } from '@main/lib/logger';

type FileSearchRuntimeClient = HostRuntimesClient['fileSearch'];

export function createFileSearchRuntime(runtimes: Pick<RuntimeBroker, 'client'>) {
  return {
    registerRoot: (root: HostAbsolutePath, host: HostRef = LOCAL_HOST_REF) =>
      registerFileSearchRoot(runtimes, root, host),
    unregisterRoot: (root: HostAbsolutePath, host: HostRef = LOCAL_HOST_REF) =>
      unregisterFileSearchRoot(runtimes, root, host),
  };
}

async function registerFileSearchRoot(
  runtimes: Pick<RuntimeBroker, 'client'>,
  root: HostAbsolutePath,
  host: HostRef = LOCAL_HOST_REF
): Promise<void> {
  try {
    const runtime = await runtimes.client(host);
    if (!runtime.success) {
      log.warn('Failed to resolve file-search runtime', { host, root, error: runtime.error });
      return;
    }
    const result = await runtime.data.fileSearch.registerRoot({ root });
    if (!result.success) {
      log.warn('Failed to register file-search root', {
        host,
        root: nativePathFromHost(root),
        error: result.error,
      });
    }
  } catch (error) {
    log.warn('File-search root registration threw unexpectedly', {
      host,
      root: nativePathFromHost(root),
      error: String(error),
    });
  }
}

async function unregisterFileSearchRoot(
  runtimes: Pick<RuntimeBroker, 'client'>,
  root: HostAbsolutePath,
  host: HostRef = LOCAL_HOST_REF
): Promise<void> {
  try {
    const runtime = await runtimes.client(host);
    if (!runtime.success) {
      log.warn('Failed to resolve file-search runtime', { host, root, error: runtime.error });
      return;
    }
    const result = await runtime.data.fileSearch.unregisterRoot({ root });
    if (!result.success) {
      log.warn('Failed to unregister file-search root', {
        host,
        root: nativePathFromHost(root),
        error: result.error,
      });
    }
  } catch (error) {
    log.warn('File-search root unregistration threw unexpectedly', {
      host,
      root: nativePathFromHost(root),
      error: String(error),
    });
  }
}

export async function searchFileSearchRoot(
  client: FileSearchRuntimeClient,
  root: HostAbsolutePath,
  query: string,
  limit?: number
): Promise<WorkspaceFileHit[]> {
  try {
    const result = await client.searchPaths({
      root,
      query,
      kinds: ['file'],
      limit: normalizeLimit(limit),
    });
    if (!result.success) {
      if (!isTransientSearchError(result.error)) {
        log.warn('Failed to search file paths', {
          root: nativePathFromHost(root),
          query,
          error: result.error,
        });
      }
      return [];
    }

    return result.data.hits.map((hit) => ({
      path: nativePathFromHost(resolveRelativePath(root, hit.path)),
      filename: portableRelativePathBasename(hit.path),
    }));
  } catch (error) {
    log.warn('File path search threw unexpectedly', {
      root: nativePathFromHost(root),
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
