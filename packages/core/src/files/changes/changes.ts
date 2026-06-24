import { lstatSync } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { IWatchService, WatchEvent, WatchHandle } from '../../watch';
import { classifyFileError, type FileError, type FilesOnError } from '../errors';
import { isIgnored, watchIgnoreGlobs } from '../ignores';
import { isRelPathWithinScope, normalizeRelPaths } from '../paths';
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
  onError?: FilesOnError;
};

export class FileChanges implements IFileChanges {
  readonly rootPath: string;
  private readonly watcher: IWatchService;
  private readonly subscriptions = new Set<WatchHandle>();
  private disposed = false;

  constructor(options: FileChangesOptions) {
    this.rootPath = options.rootPath;
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

    const watchedPaths = normalizeWatchedPaths(options.paths);
    if (!watchedPaths.success) return watchedPaths;

    const handle = this.watcher.watch(
      this.rootPath,
      (events) => {
        const changes = rawEventsToChanges(this.rootPath, events, watchedPaths.data);
        if (changes.length > 0) cb({ kind: 'changes', changes });
      },
      {
        ignore: watchIgnoreGlobs(),
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

function normalizeWatchedPaths(paths: string[] | undefined): Result<string[], FileError> {
  if (!paths || paths.length === 0) return ok(['']);
  return normalizeRelPaths(paths, { allowEmpty: true });
}

function rawEventsToChanges(
  rootPath: string,
  events: WatchEvent[],
  watchedPaths: string[]
): FileChange[] {
  const changes: FileChange[] = [];
  for (const event of events) {
    const relPath = relativeFromRawEvent(rootPath, event);
    if (!relPath) continue;
    if (isIgnored(relPath)) continue;
    if (!isWatchedPath(relPath, watchedPaths)) continue;
    changes.push({
      kind: event.kind,
      path: relPath,
      entryType: entryTypeForRawEvent(event),
    });
  }
  return changes;
}

function relativeFromRawEvent(rootPath: string, event: WatchEvent): string | null {
  const relPath = path.relative(rootPath, event.path).replace(/\\/g, '/');
  if (!relPath || relPath === '..' || relPath.startsWith('../') || path.isAbsolute(relPath)) {
    return null;
  }
  return relPath;
}

function isWatchedPath(relPath: string, watchedPaths: string[]): boolean {
  return watchedPaths.some((watchedPath) => isRelPathWithinScope(relPath, watchedPath));
}

function entryTypeForRawEvent(event: WatchEvent): FileEntryType {
  if (event.kind === 'delete') return 'unknown';
  try {
    return lstatSync(event.path).isDirectory() ? 'directory' : 'file';
  } catch {
    return 'unknown';
  }
}
