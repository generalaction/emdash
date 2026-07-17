import {
  portableRelativePathBasename,
  type HostAbsolutePath,
} from '@emdash/core/primitives/path/api';
import {
  PATH_SEARCH_DEFAULT_LIMIT,
  PATH_SEARCH_MAX_LIMIT,
  type PathSearchError,
} from '@emdash/core/runtimes/file-search/api';
import { nativePathFromHost, resolveRelativePath } from '@core/primitives/desktop-runtime/api';
import type { WorkspaceFileHit } from '@core/primitives/search/api';
import { getFileSearchRuntimeClient } from '@main/gateway/accessors';
import { log } from '@main/lib/logger';

export async function registerFileSearchRoot(root: HostAbsolutePath): Promise<void> {
  try {
    const result = await (await getFileSearchRuntimeClient()).registerRoot({ root });
    if (!result.success) {
      log.warn('Failed to register file-search root', {
        root: nativePathFromHost(root),
        error: result.error,
      });
    }
  } catch (error) {
    log.warn('File-search root registration threw unexpectedly', {
      root: nativePathFromHost(root),
      error: String(error),
    });
  }
}

export async function unregisterFileSearchRoot(root: HostAbsolutePath): Promise<void> {
  try {
    const result = await (await getFileSearchRuntimeClient()).unregisterRoot({ root });
    if (!result.success) {
      log.warn('Failed to unregister file-search root', {
        root: nativePathFromHost(root),
        error: result.error,
      });
    }
  } catch (error) {
    log.warn('File-search root unregistration threw unexpectedly', {
      root: nativePathFromHost(root),
      error: String(error),
    });
  }
}

export async function searchFileSearchRoot(
  root: HostAbsolutePath,
  query: string,
  limit?: number
): Promise<WorkspaceFileHit[]> {
  try {
    const result = await (
      await getFileSearchRuntimeClient()
    ).searchPaths({
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
