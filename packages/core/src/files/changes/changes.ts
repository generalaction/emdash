import { lstatSync } from 'node:fs';
import path from 'node:path';
import { err, ok, type Result } from '@emdash/shared';
import type { IWatchService, WatchEvent, WatchHandle } from '../../watch';
import { classifyFileError, type FileError, type FilesOnError } from '../errors';
import { isIgnored, watchIgnoreGlobs } from '../ignores';
import { contains, validateAbsolutePath } from '../paths';
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

    const watchedPaths = normalizeWatchedPaths(this.rootPath, options.paths);
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

function normalizeWatchedPaths(
  rootPath: string,
  paths: string[] | undefined
): Result<string[], FileError> {
  if (!paths || paths.length === 0) return ok([]);
  const normalized: string[] = [];
  for (const input of paths) {
    const validated = validateAbsolutePath(input);
    if (!validated.success) return validated;
    if (!contains(rootPath, validated.data)) {
      return err({
        type: 'invalid-path',
        path: input,
        message: `Watched path must be inside root: ${input}`,
      });
    }
    normalized.push(validated.data);
  }
  return ok(normalized);
}

function rawEventsToChanges(
  rootPath: string,
  events: WatchEvent[],
  watchedPaths: string[]
): FileChange[] {
  const changes: FileChange[] = [];
  for (const event of events) {
    const absPath = absoluteFromRawEvent(rootPath, event);
    if (!absPath) continue;
    if (isIgnored(absPath)) continue;
    if (!isWatchedPath(absPath, rootPath, watchedPaths)) continue;
    changes.push({
      kind: event.kind,
      path: absPath,
      entryType: entryTypeForRawEvent(event),
    });
  }
  return changes;
}

function absoluteFromRawEvent(rootPath: string, event: WatchEvent): string | null {
  const relPath = path.relative(rootPath, event.path).replace(/\\/g, '/');
  if (!relPath || relPath === '..' || relPath.startsWith('../') || path.isAbsolute(relPath)) {
    return null;
  }
  return path.normalize(event.path);
}

function isWatchedPath(absPath: string, rootPath: string, watchedPaths: string[]): boolean {
  if (watchedPaths.length === 0) return contains(rootPath, absPath);
  return watchedPaths.some((watchedPath) => contains(watchedPath, absPath));
}

function entryTypeForRawEvent(event: WatchEvent): FileEntryType {
  if (event.kind === 'delete') return 'unknown';
  try {
    return lstatSync(event.path).isDirectory() ? 'directory' : 'file';
  } catch {
    return 'unknown';
  }
}
