import { lstatSync } from 'node:fs';
import { err, ok, type Result } from '@emdash/shared';
import type { IWatchService, WatchEvent, WatchHandle } from '../../services/fs-watch/api';
import { classifyFileError, type FileError } from '../errors';
import { includeAllFiles } from '../exclusions';
import { createRootPathPolicy, type RootPathPolicy } from '../path-policy';
import type {
  FileChange,
  FileChangeSubscription,
  FileChangeUpdate,
  FileChangeWatchOptions,
  FileEntryType,
  IFileChanges,
} from './types';

const DEFAULT_CHANGE_DEBOUNCE_MS = 100;

export type FileChangesOptions = {
  rootPath: string;
  watcher: IWatchService;
};

export class FileChanges implements IFileChanges {
  readonly rootPath: string;
  private readonly pathPolicy: RootPathPolicy;
  private readonly watcher: IWatchService;
  private readonly subscriptions = new Set<WatchHandle>();
  private disposed = false;

  constructor(options: FileChangesOptions) {
    const policy = createRootPathPolicy(options.rootPath);
    if (!policy.success) throw new Error(policy.error.message);
    this.pathPolicy = policy.data;
    this.rootPath = this.pathPolicy.rootPath;
    this.watcher = options.watcher;
  }

  watch(
    cb: (update: FileChangeUpdate) => void,
    options: FileChangeWatchOptions = {}
  ): Result<FileChangeSubscription, FileError> {
    if (this.disposed) {
      return err({
        type: 'fs-error',
        path: this.rootPath,
        message: 'FileChanges disposed',
      });
    }

    const watchedPaths = normalizeWatchedPaths(this.pathPolicy, options.paths);
    if (!watchedPaths.success) return watchedPaths;
    const exclude = options.exclude ?? includeAllFiles;

    const handle = this.watcher.watch(
      this.rootPath,
      (events) => {
        const changes = rawEventsToChanges(this.pathPolicy, events, watchedPaths.data, exclude);
        if (changes.length > 0) cb({ kind: 'changes', changes });
      },
      {
        debounceMs: options.debounceMs ?? DEFAULT_CHANGE_DEBOUNCE_MS,
        onResync: () => cb({ kind: 'resync' }),
      }
    );
    this.subscriptions.add(handle);

    let unsubscribed = false;
    const unsubscribe = () => {
      if (unsubscribed) return;
      unsubscribed = true;
      this.subscriptions.delete(handle);
      handle.release();
    };

    return ok({
      ready: async () => {
        try {
          await handle.ready();
          return ok<void>();
        } catch (error) {
          return err(classifyFileError(error, this.rootPath));
        }
      },
      unsubscribe,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const handle of this.subscriptions) handle.release();
    this.subscriptions.clear();
  }
}

function normalizeWatchedPaths(
  pathPolicy: RootPathPolicy,
  paths: string[] | undefined
): Result<RootPathPolicy[], FileError> {
  if (!paths || paths.length === 0) return ok([]);
  const normalized: RootPathPolicy[] = [];
  for (const input of paths) {
    const resolved = pathPolicy.resolveInsideRoot(input);
    if (!resolved.success) return resolved;
    const nestedPolicy = createRootPathPolicy(resolved.data);
    if (!nestedPolicy.success) return nestedPolicy;
    normalized.push(nestedPolicy.data);
  }
  return ok(normalized);
}

function rawEventsToChanges(
  pathPolicy: RootPathPolicy,
  events: WatchEvent[],
  watchedPaths: RootPathPolicy[],
  exclude: (absPath: string) => boolean
): FileChange[] {
  const changes: FileChange[] = [];
  for (const event of events) {
    const absPath = pathPolicy.absoluteFromWatchEvent(event.path);
    if (!absPath) continue;
    if (exclude(absPath)) continue;
    if (!isWatchedPath(absPath, pathPolicy, watchedPaths)) continue;
    changes.push({
      kind: event.kind,
      path: absPath,
      entryType: entryTypeForRawEvent(event),
    });
  }
  return changes;
}

function isWatchedPath(
  absPath: string,
  pathPolicy: RootPathPolicy,
  watchedPaths: RootPathPolicy[]
): boolean {
  if (watchedPaths.length === 0) return pathPolicy.contains(absPath);
  return watchedPaths.some((watchedPath) => watchedPath.contains(absPath));
}

function entryTypeForRawEvent(event: WatchEvent): FileEntryType {
  if (event.kind === 'delete') return 'unknown';
  try {
    const stat = lstatSync(event.path);
    if (stat.isSymbolicLink()) return 'symlink';
    return stat.isDirectory() ? 'directory' : 'file';
  } catch {
    return 'unknown';
  }
}
