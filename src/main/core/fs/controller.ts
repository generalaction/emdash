import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fsEvents } from '@main/core/fs/fs-events';
import { events } from '@main/lib/events';
import { planEventChannel } from '@shared/events/appEvents';
import { fsWatchEventChannel } from '@shared/events/fsEvents';
import { createRPCController } from '@shared/lib/ipc/rpc';
import { err, ok } from '@shared/result';
import { resolveWorkspace } from '../projects/utils';
import {
  FileSystemErrorCodes,
  type FileWatcher,
  type ListOptions,
  type SearchOptions,
} from './types';

// One watcher per (projectId, workspaceId) pair, shared across all consumers via labels.
// Local: single recursive @parcel/watcher subscription — update() is a no-op.
// SSH:   poll-based — update() receives the union of all labels' paths to poll.
const watcherRegistry = new Map<string, FileWatcher>();
// Per-label path groups, keyed by `${projectId}::${workspaceId}` → label → paths.
// Paths are forwarded to update() for SSH compatibility; local ignores them.
const watcherLabeledPaths = new Map<string, Map<string, string[]>>();

function normalizeRelativePath(filePath: string, options?: { allowEmpty?: boolean }): string {
  if (!filePath && options?.allowEmpty) return '';
  const normalized = path.posix.normalize(filePath.replaceAll('\\', '/'));
  if (
    !filePath ||
    path.isAbsolute(filePath) ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(filePath) ||
    normalized === '..' ||
    normalized.startsWith('../') ||
    normalized.includes('/../')
  ) {
    throw new Error('Invalid file path');
  }
  return normalized === '.' ? '' : normalized;
}

function joinWorkspacePath(rootPath: string, filePath: string): string {
  if (!filePath) return rootPath;
  const separator =
    rootPath.includes('\\') && !rootPath.includes('/') ? path.win32.sep : path.posix.sep;
  return rootPath.endsWith('/') || rootPath.endsWith('\\')
    ? `${rootPath}${filePath}`
    : `${rootPath}${separator}${filePath}`;
}

export const filesController = createRPCController({
  listFiles: async (
    projectId: string,
    workspaceId: string,
    dirPath: string,
    options?: ListOptions
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.list(dirPath, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readFile: async (projectId: string, workspaceId: string, filePath: string, maxBytes?: number) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.read(filePath, maxBytes);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  writeFile: async (projectId: string, workspaceId: string, filePath: string, content: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.write(filePath, content);
      return ok(result);
    } catch (e) {
      if (
        e instanceof Error &&
        (e as unknown as { code?: string }).code === FileSystemErrorCodes.PERMISSION_DENIED
      ) {
        events.emit(planEventChannel, {
          type: 'write_blocked' as const,
          root: projectId,
          relPath: filePath,
          message: e.message,
        });
      }
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  removeFile: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.remove) {
      return err({
        type: 'fs_error' as const,
        message: 'remove not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.remove(filePath);
      return ok(result);
    } catch (e) {
      if (
        e instanceof Error &&
        (e as unknown as { code?: string }).code === FileSystemErrorCodes.PERMISSION_DENIED
      ) {
        events.emit(planEventChannel, {
          type: 'remove_blocked' as const,
          root: projectId,
          relPath: filePath,
          message: e.message,
        });
      }
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  readImage: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.readImage) {
      return err({
        type: 'fs_error' as const,
        message: 'readImage not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.readImage(filePath);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  searchFiles: async (
    projectId: string,
    workspaceId: string,
    query: string,
    options?: SearchOptions
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const result = await env.fs.search(query, options);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  statFile: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const entry = await env.fs.stat(filePath);
      return ok({ entry });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  fileExists: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      const exists = await env.fs.exists(filePath);
      return ok({ exists });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  getAbsolutePath: async (projectId: string, workspaceId: string, filePath: string) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    try {
      return ok({ path: joinWorkspacePath(env.path, normalizeRelativePath(filePath)) });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  copyLocalFiles: async (
    projectId: string,
    workspaceId: string,
    srcPaths: string[],
    destDirPath: string,
    options?: { overwrite?: boolean }
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.copyLocalFile) {
      return err({
        type: 'fs_error' as const,
        message: 'copyLocalFile not supported by this filesystem',
      });
    }

    try {
      const destDir = normalizeRelativePath(destDirPath, { allowEmpty: true });
      await env.fs.mkdir(destDir || '.', { recursive: true });

      const plannedCopies = await Promise.all(
        srcPaths.map(async (srcPath) => {
          if (!path.isAbsolute(srcPath)) throw new Error('Source path must be absolute');
          const fileName = path.basename(srcPath);
          if (!fileName) throw new Error('Source path must include a file name');
          const srcStat = await fs.stat(srcPath);
          if (srcStat.isDirectory()) throw new Error(`Cannot import directories: ${srcPath}`);
          const destRelPath = destDir ? path.posix.join(destDir, fileName) : fileName;
          return { srcPath, destRelPath };
        })
      );

      const seenDestPaths = new Set<string>();
      const conflicts: string[] = [];
      for (const { destRelPath } of plannedCopies) {
        if (seenDestPaths.has(destRelPath))
          throw new Error(`Duplicate destination: ${destRelPath}`);
        seenDestPaths.add(destRelPath);
        if (!options?.overwrite && (await env.fs.exists(destRelPath))) conflicts.push(destRelPath);
      }
      if (conflicts.length > 0) throw new Error(`Files already exist:\n${conflicts.join('\n')}`);

      for (const { srcPath, destRelPath } of plannedCopies) {
        await env.fs.copyLocalFile(srcPath, destRelPath);
      }

      return ok({ copied: srcPaths.length });
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  saveAttachment: async (
    projectId: string,
    workspaceId: string,
    srcPath: string,
    subdir?: string
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env)
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });

    if (!env.fs.saveAttachment) {
      return err({
        type: 'fs_error' as const,
        message: 'saveAttachment not supported by this filesystem',
      });
    }

    try {
      const result = await env.fs.saveAttachment(srcPath, subdir);
      return ok(result);
    } catch (e) {
      return err({ type: 'fs_error' as const, message: String(e) });
    }
  },

  watchSetPaths: async (
    projectId: string,
    workspaceId: string,
    paths: string[],
    label = 'default'
  ) => {
    const env = resolveWorkspace(projectId, workspaceId);
    if (!env) {
      return err({ type: 'not_found' as const, entity: 'filesystem' as const, detail: undefined });
    }

    if (!env.fs.watch) {
      return ok({ supported: false as const });
    }

    const key = `${projectId}::${workspaceId}`;
    const groups = watcherLabeledPaths.get(key) ?? new Map<string, string[]>();
    groups.set(label, paths);
    watcherLabeledPaths.set(key, groups);
    const union = [...new Set([...groups.values()].flat())];

    const existing = watcherRegistry.get(key);
    if (existing) {
      existing.update(union);
    } else {
      const watcher = env.fs.watch((evts) => {
        const event = { projectId, workspaceId, events: evts };
        events.emit(fsWatchEventChannel, event);
        fsEvents.emitWatchEvent(event);
      });
      watcher.update(union);
      watcherRegistry.set(key, watcher);
    }
    return ok({ supported: true as const });
  },

  watchStop: async (projectId: string, workspaceId: string, label = 'default') => {
    const key = `${projectId}::${workspaceId}`;
    const groups = watcherLabeledPaths.get(key);
    groups?.delete(label);

    if (!groups?.size) {
      watcherLabeledPaths.delete(key);
      watcherRegistry.get(key)?.close();
      watcherRegistry.delete(key);
    } else {
      const union = [...new Set([...groups.values()].flat())];
      watcherRegistry.get(key)?.update(union);
    }
    return ok({});
  },
});
