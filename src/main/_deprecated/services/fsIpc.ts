import { ipcMain } from 'electron';
import { createRPCController } from '../../../shared/ipc/rpc';
import { events } from '../../_new/lib/events';
import { planEventChannel, type PlanEvent } from '@shared/events/appEvents';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { FsListWorkerResponse } from '../types/fsListWorker';
import workerPath from '../workers/fsListWorker?modulePath';
import { DEFAULT_IGNORES } from '../utils/fsIgnores';
import { safeStat } from '../utils/safeStat';
import { sshService } from './ssh/SshService';
import { SshFileSystem } from '../../_new/environment/impl/fs-provider/ssh-fs';

const DEFAULT_EMDASH_CONFIG = `{
  "preservePatterns": [
    ".env",
    ".env.keys",
    ".env.local",
    ".env.*.local",
    ".envrc",
    "docker-compose.override.yml"
  ],
  "scripts": {
    "setup": "",
    "run": "",
    "teardown": ""
  }
}
`;

type RemoteParams = {
  connectionId?: string;
  remotePath?: string;
};

function isRemoteRequest(args: RemoteParams): args is { connectionId: string; remotePath: string } {
  return Boolean(args.connectionId && args.remotePath);
}

function createRemoteFs(args: { connectionId: string; remotePath: string }): SshFileSystem {
  return new SshFileSystem(sshService, args.connectionId, args.remotePath);
}

type ListArgs = {
  root: string;
  includeDirs?: boolean;
  recursive?: boolean;
  maxEntries?: number;
  timeBudgetMs?: number;
} & RemoteParams;

type ListWorkerState = {
  worker: Worker;
  requestId: number;
  canceled: boolean;
};

const listWorkersBySender = new Map<number, ListWorkerState>();
const DEFAULT_TIME_BUDGET_MS = 2000;
const MIN_TIME_BUDGET_MS = 250;
const MAX_TIME_BUDGET_MS = 10000;
const MAX_FILES_TO_SEARCH = 10000;
const DEFAULT_BATCH_SIZE = 250;

// Centralized configuration/constants for attachments
const ALLOWED_IMAGE_EXTENSIONS = new Set<string>([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.bmp',
  '.svg',
]);
const DEFAULT_ATTACHMENTS_SUBDIR = 'attachments' as const;

function emitPlanEvent(payload: PlanEvent) {
  events.emit(planEventChannel, payload);
}

export function registerFsIpc(): void {
  ipcMain.handle('fs:list', async (_event, args: ListArgs) => {
    try {
      // --- Remote path: delegate to RemoteFileSystem ---
      if (isRemoteRequest(args)) {
        try {
          const rfs = createRemoteFs(args);
          const maxEntries = Math.min(Math.max(args.maxEntries ?? 5000, 100), MAX_FILES_TO_SEARCH);
          const result = await rfs.listRecursive({
            includeDirs: args.includeDirs ?? true,
            maxEntries,
          });
          return {
            success: true,
            items: result.items,
            truncated: result.truncated,
            reason: result.truncated ? 'maxEntries' : undefined,
          };
        } catch (error) {
          console.error('fs:list remote failed:', error);
          return { success: false, error: 'Failed to list remote files' };
        }
      }

      // --- Local path ---
      const root = args.root;
      const includeDirs = args.includeDirs ?? true;
      const maxEntries = Math.min(Math.max(args.maxEntries ?? 5000, 100), MAX_FILES_TO_SEARCH);
      const timeBudgetMs = Math.min(
        Math.max(args.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS, MIN_TIME_BUDGET_MS),
        MAX_TIME_BUDGET_MS
      );
      if (!root || !fs.existsSync(root)) {
        return { success: false, error: 'Invalid root path' };
      }

      const senderId = _event.sender.id;
      const prev = listWorkersBySender.get(senderId);
      if (prev) {
        prev.canceled = true;
        prev.worker.terminate().catch(() => {});
      }

      const requestId = (prev?.requestId ?? 0) + 1;
      const worker = new Worker(workerPath);
      const state: ListWorkerState = { worker, requestId, canceled: false };
      listWorkersBySender.set(senderId, state);

      const result = await new Promise<FsListWorkerResponse>((resolve, reject) => {
        const cleanup = () => {
          worker.removeAllListeners('message');
          worker.removeAllListeners('error');
          worker.removeAllListeners('exit');
        };

        worker.once('message', (message) => {
          cleanup();
          worker.terminate().catch(() => {});
          resolve(message as FsListWorkerResponse);
        });
        worker.once('error', (error) => {
          cleanup();
          reject(error);
        });
        worker.once('exit', (code) => {
          cleanup();
          if (state.canceled) {
            resolve({ taskId: requestId, ok: false, error: 'Canceled' });
            return;
          }
          if (code === 0) {
            resolve({
              taskId: requestId,
              ok: false,
              error: 'Worker exited before responding',
            });
            return;
          }
          reject(new Error(`fs:list worker exited with code ${code}`));
        });

        worker.postMessage({
          taskId: requestId,
          root,
          includeDirs,
          recursive: args.recursive !== false, // Default to true if not specified
          maxEntries,
          timeBudgetMs,
          batchSize: DEFAULT_BATCH_SIZE,
        });
      });

      const latest = listWorkersBySender.get(senderId);
      if (!latest || latest.requestId !== requestId || state.canceled) {
        return { success: true, canceled: true };
      }

      listWorkersBySender.delete(senderId);

      if (!result.ok) {
        if (result.error === 'Canceled') return { success: true, canceled: true };
        return { success: false, error: result.error };
      }

      return {
        success: true,
        items: result.items,
        truncated: result.truncated,
        reason: result.reason,
        durationMs: result.durationMs,
      };
    } catch (error) {
      console.error('fs:list failed:', error);
      return { success: false, error: 'Failed to list files' };
    }
  });
}

// Constants for file search
const SEARCH_PREVIEW_CONTEXT_LENGTH = 30;
const DEFAULT_MAX_SEARCH_RESULTS = 10000;
const MAX_FILE_SIZE = 2 * 1024 * 1024;
const MAX_SEARCH_FILES = 20000;
const BINARY_CHECK_BYTES = 512;

const SEARCH_IGNORES = new Set([
  ...DEFAULT_IGNORES,
  '.vscode',
  '.idea',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  'vendor',
  'bower_components',
  '.turbo',
  'worktrees',
  '.worktrees',
]);

const BINARY_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.bmp',
  '.ico',
  '.svg',
  '.pdf',
  '.zip',
  '.tar',
  '.gz',
  '.rar',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.a',
  '.o',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.wav',
  '.flac',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.pyc',
  '.pyo',
  '.class',
  '.jar',
  '.war',
  '.node',
  '.wasm',
  '.map',
  '.DS_Store',
  '.lock',
]);

function isBinaryFile(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) return true;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(BINARY_CHECK_BYTES);
    const bytesRead = fs.readSync(fd, buffer, 0, BINARY_CHECK_BYTES, 0);
    fs.closeSync(fd);
    for (let i = 0; i < bytesRead; i++) {
      if (buffer[i] === 0) return true;
    }
    let nonPrintable = 0;
    for (let i = 0; i < Math.min(bytesRead, 512); i++) {
      const byte = buffer[i];
      if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) nonPrintable++;
    }
    return nonPrintable > bytesRead * 0.3;
  } catch {
    return false;
  }
}

export const fsController = createRPCController({
  read: async (args: { root: string; relPath: string; maxBytes?: number } & RemoteParams) => {
    try {
      if (isRemoteRequest(args)) {
        try {
          const rfs = createRemoteFs(args);
          const maxBytes = Math.min(Math.max(args.maxBytes ?? 200 * 1024, 1024), 5 * 1024 * 1024);
          const result = await rfs.read(args.relPath, maxBytes);
          return {
            success: true,
            path: args.relPath,
            size: result.totalSize,
            truncated: result.truncated,
            content: result.content,
          };
        } catch (error) {
          console.error('fs:read remote failed:', error);
          return { success: false, error: 'Failed to read remote file' };
        }
      }
      const { root, relPath } = args;
      const maxBytes = Math.min(Math.max(args.maxBytes ?? 200 * 1024, 1024), 5 * 1024 * 1024);
      if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
      if (!relPath) return { success: false, error: 'Invalid relPath' };
      const abs = path.resolve(root, relPath);
      const normRoot = path.resolve(root) + path.sep;
      if (!abs.startsWith(normRoot)) return { success: false, error: 'Path escapes root' };
      const st = safeStat(abs);
      if (!st) return { success: false, error: 'Not found' };
      if (st.isDirectory()) return { success: false, error: 'Is a directory' };
      const size = st.size;
      let truncated = false;
      let content: string;
      const fd = fs.openSync(abs, 'r');
      try {
        const bytesToRead = Math.min(size, maxBytes);
        const buf = Buffer.alloc(bytesToRead);
        fs.readSync(fd, buf, 0, bytesToRead, 0);
        content = buf.toString('utf8');
        truncated = size > bytesToRead;
      } finally {
        fs.closeSync(fd);
      }
      return { success: true, path: relPath, size, truncated, content };
    } catch (error) {
      console.error('fs:read failed:', error);
      return { success: false, error: 'Failed to read file' };
    }
  },

  readImage: async (args: { root: string; relPath: string } & RemoteParams) => {
    try {
      if (isRemoteRequest(args)) {
        try {
          const rfs = createRemoteFs(args);
          return await rfs.readImage(args.relPath);
        } catch (error) {
          console.error('fs:read-image remote failed:', error);
          return { success: false, error: 'Failed to read remote image' };
        }
      }
      const { root, relPath } = args;
      if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
      if (!relPath) return { success: false, error: 'Invalid relPath' };
      const abs = path.resolve(root, relPath);
      const normRoot = path.resolve(root) + path.sep;
      if (!abs.startsWith(normRoot)) return { success: false, error: 'Path escapes root' };
      const st = safeStat(abs);
      if (!st) return { success: false, error: 'Not found' };
      if (st.isDirectory()) return { success: false, error: 'Is a directory' };
      const ext = path.extname(relPath).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) return { success: false, error: 'Not an image file' };
      const buffer = fs.readFileSync(abs);
      const base64 = buffer.toString('base64');
      let mimeType = 'image/';
      switch (ext) {
        case '.svg':
          mimeType += 'svg+xml';
          break;
        case '.jpg':
        case '.jpeg':
          mimeType += 'jpeg';
          break;
        default:
          mimeType += ext.substring(1);
      }
      return {
        success: true,
        dataUrl: `data:${mimeType};base64,${base64}`,
        mimeType,
        size: st.size,
      };
    } catch (error) {
      console.error('fs:read-image failed:', error);
      return { success: false, error: 'Failed to read image' };
    }
  },

  searchContent: async (
    args: {
      root: string;
      query: string;
      options?: { caseSensitive?: boolean; maxResults?: number; fileExtensions?: string[] };
    } & RemoteParams
  ) => {
    try {
      if (isRemoteRequest(args)) {
        try {
          const rfs = createRemoteFs(args);
          const { query, options = {} } = args;
          const {
            caseSensitive = false,
            maxResults = DEFAULT_MAX_SEARCH_RESULTS,
            fileExtensions = [],
          } = options;
          const searchResult = await rfs.search(query, {
            caseSensitive,
            maxResults,
            fileExtensions,
          });
          const groupedMap = new Map<
            string,
            Array<{ line: number; column: number; text: string; preview: string }>
          >();
          for (const match of searchResult.matches) {
            const file = match.filePath;
            if (!groupedMap.has(file)) groupedMap.set(file, []);
            groupedMap.get(file)!.push({
              line: match.line,
              column: match.column,
              text: match.content,
              preview: match.preview || match.content,
            });
          }
          const results = Array.from(groupedMap.entries()).map(([file, matches]) => ({
            file,
            matches,
          }));
          return { success: true, results };
        } catch (error) {
          console.error('fs:searchContent remote failed:', error);
          return { success: false, error: 'Failed to search remote files' };
        }
      }
      const { root, query, options = {} } = args;
      const {
        caseSensitive = false,
        maxResults = DEFAULT_MAX_SEARCH_RESULTS,
        fileExtensions = [],
      } = options;
      if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
      if (!query || query.length < 2)
        return { success: false, error: 'Query too short (min 2 chars)' };
      let gitIgnore: GitIgnoreParser | undefined;
      try {
        const content = await fs.promises.readFile(path.join(root, '.gitignore'), 'utf8');
        gitIgnore = new GitIgnoreParser(content);
      } catch {}
      const results: Array<{
        file: string;
        matches: Array<{ line: number; column: number; text: string; preview: string }>;
      }> = [];
      let totalMatches = 0;
      let filesSearched = 0;
      const searchQuery = caseSensitive ? query : query.toLowerCase();
      const shouldSearchFile = (filePath: string, stat: fs.Stats): boolean => {
        if (stat.size > MAX_FILE_SIZE) return false;
        const ext = path.extname(filePath).toLowerCase();
        if (ext && BINARY_EXTENSIONS.has(ext)) return false;
        if (fileExtensions.length > 0) {
          return fileExtensions.some((e) => {
            const normalizedExt = e.toLowerCase().startsWith('.')
              ? e.toLowerCase()
              : '.' + e.toLowerCase();
            return ext === normalizedExt;
          });
        }
        return true;
      };
      const searchInFile = async (filePath: string): Promise<void> => {
        if (totalMatches >= maxResults || filesSearched >= MAX_SEARCH_FILES) return;
        try {
          filesSearched++;
          if (isBinaryFile(filePath)) return;
          const content = await fs.promises.readFile(filePath, 'utf8');
          const contentToSearch = caseSensitive ? content : content.toLowerCase();
          if (!contentToSearch.includes(searchQuery)) return;
          const lines = content.split('\n');
          const fileMatches: (typeof results)[0]['matches'] = [];
          for (let lineNum = 0; lineNum < lines.length && totalMatches < maxResults; lineNum++) {
            const line = lines[lineNum];
            const searchLine = caseSensitive ? line : line.toLowerCase();
            if (!searchLine.includes(searchQuery)) continue;
            let columnIndex = searchLine.indexOf(searchQuery);
            while (columnIndex !== -1 && totalMatches < maxResults) {
              const previewStart = Math.max(0, columnIndex - SEARCH_PREVIEW_CONTEXT_LENGTH);
              const previewEnd = Math.min(
                line.length,
                columnIndex + query.length + SEARCH_PREVIEW_CONTEXT_LENGTH
              );
              let preview = line.substring(previewStart, previewEnd).trim();
              if (previewStart > 0) preview = '...' + preview;
              if (previewEnd < line.length) preview = preview + '...';
              fileMatches.push({
                line: lineNum + 1,
                column: columnIndex + 1,
                text: line.substring(columnIndex, columnIndex + query.length),
                preview,
              });
              totalMatches++;
              columnIndex = searchLine.indexOf(searchQuery, columnIndex + 1);
            }
          }
          if (fileMatches.length > 0)
            results.push({ file: path.relative(root, filePath), matches: fileMatches });
        } catch {}
      };
      const collectFiles = async (dirPath: string, files: string[] = []): Promise<string[]> => {
        if (files.length >= MAX_SEARCH_FILES) return files;
        try {
          const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (files.length >= MAX_SEARCH_FILES) break;
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
              const relPath = path.relative(root, fullPath);
              if (gitIgnore && (gitIgnore.ignores(relPath) || gitIgnore.ignores(relPath + '/')))
                continue;
              if (!SEARCH_IGNORES.has(entry.name)) await collectFiles(fullPath, files);
            } else if (entry.isFile()) {
              try {
                const stat = await fs.promises.stat(fullPath);
                if (shouldSearchFile(fullPath, stat)) files.push(fullPath);
              } catch {}
            }
          }
        } catch {}
        return files;
      };
      const files = await collectFiles(root);
      const BATCH_SIZE = 10;
      for (let i = 0; i < files.length && totalMatches < maxResults; i += BATCH_SIZE) {
        await Promise.all(files.slice(i, i + BATCH_SIZE).map((file) => searchInFile(file)));
      }
      return { success: true, results };
    } catch (error) {
      console.error('fs:searchContent failed:', error);
      return { success: false, error: 'Failed to search files' };
    }
  },

  saveAttachment: async (args: { taskPath: string; srcPath: string; subdir?: string }) => {
    try {
      const { taskPath, srcPath } = args;
      if (!taskPath || !fs.existsSync(taskPath))
        return { success: false, error: 'Invalid taskPath' };
      if (!srcPath || !fs.existsSync(srcPath)) return { success: false, error: 'Invalid srcPath' };
      const ext = path.extname(srcPath).toLowerCase();
      if (!ALLOWED_IMAGE_EXTENSIONS.has(ext))
        return { success: false, error: 'Unsupported attachment type' };
      const baseDir = path.join(taskPath, '.emdash', args.subdir || DEFAULT_ATTACHMENTS_SUBDIR);
      fs.mkdirSync(baseDir, { recursive: true });
      const baseName = path.basename(srcPath);
      let destName = baseName;
      let counter = 1;
      let destAbs = path.join(baseDir, destName);
      while (fs.existsSync(destAbs)) {
        const name = path.basename(baseName, ext);
        destName = `${name}-${counter}${ext}`;
        destAbs = path.join(baseDir, destName);
        counter++;
      }
      fs.copyFileSync(srcPath, destAbs);
      const relFromTask = path.relative(taskPath, destAbs);
      return { success: true, absPath: destAbs, relPath: relFromTask, fileName: destName };
    } catch (error) {
      console.error('fs:save-attachment failed:', error);
      return { success: false, error: 'Failed to save attachment' };
    }
  },

  write: async (
    args: { root: string; relPath: string; content: string; mkdirs?: boolean } & RemoteParams
  ) => {
    try {
      if (isRemoteRequest(args)) {
        try {
          const rfs = createRemoteFs(args);
          const result = await rfs.write(args.relPath, args.content);
          return { success: result.success };
        } catch (error) {
          console.error('fs:write remote failed:', error);
          return { success: false, error: 'Failed to write remote file' };
        }
      }
      const { root, relPath, content, mkdirs = true } = args;
      if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
      if (!relPath) return { success: false, error: 'Invalid relPath' };
      const abs = path.resolve(root, relPath);
      const normRoot = path.resolve(root) + path.sep;
      if (!abs.startsWith(normRoot)) return { success: false, error: 'Path escapes root' };
      const dir = path.dirname(abs);
      if (mkdirs) fs.mkdirSync(dir, { recursive: true });
      try {
        fs.writeFileSync(abs, content, 'utf8');
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        if ((err?.code || '').toUpperCase() === 'EACCES') {
          emitPlanEvent({
            type: 'write_blocked',
            root,
            relPath,
            code: err?.code,
            message: err?.message || String(e),
          });
        }
        throw e;
      }
      return { success: true };
    } catch (error) {
      console.error('fs:write failed:', error);
      return { success: false, error: 'Failed to write file' };
    }
  },

  remove: async (args: { root: string; relPath: string } & RemoteParams) => {
    try {
      if (isRemoteRequest(args)) {
        try {
          const rfs = createRemoteFs(args);
          return await rfs.remove(args.relPath);
        } catch (error) {
          console.error('fs:remove remote failed:', error);
          return { success: false, error: 'Failed to remove remote file' };
        }
      }
      const { root, relPath } = args;
      if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
      if (!relPath) return { success: false, error: 'Invalid relPath' };
      const abs = path.resolve(root, relPath);
      const normRoot = path.resolve(root) + path.sep;
      if (!abs.startsWith(normRoot)) return { success: false, error: 'Path escapes root' };
      if (!fs.existsSync(abs)) return { success: true };
      const st = safeStat(abs);
      if (st && st.isDirectory()) return { success: false, error: 'Is a directory' };
      try {
        fs.unlinkSync(abs);
      } catch (e: unknown) {
        const err = e as { code?: string; message?: string };
        try {
          const dst = safeStat(path.dirname(abs));
          if (dst) fs.chmodSync(path.dirname(abs), (dst.mode & 0o7777) | 0o222);
        } catch {}
        try {
          const fst = safeStat(abs);
          if (fst) fs.chmodSync(abs, (fst.mode & 0o7777) | 0o222);
        } catch {}
        try {
          fs.unlinkSync(abs);
        } catch (e2: unknown) {
          const err2 = e2 as { code?: string; message?: string };
          if ((err2?.code || '').toUpperCase() === 'EACCES') {
            emitPlanEvent({
              type: 'remove_blocked',
              root,
              relPath,
              code: err2?.code,
              message: err2?.message || String(e2),
            });
          }
          throw e2;
        }
        void err;
      }
      return { success: true };
    } catch (error) {
      console.error('fs:remove failed:', error);
      return { success: false, error: 'Failed to remove file' };
    }
  },

  getProjectConfig: async (args: { projectPath: string }) => {
    try {
      const { projectPath } = args;
      if (!projectPath || !fs.existsSync(projectPath))
        return { success: false, error: 'Invalid project path' };
      const configPath = path.join(projectPath, '.emdash.json');
      if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, DEFAULT_EMDASH_CONFIG, 'utf8');
      const content = fs.readFileSync(configPath, 'utf8');
      return { success: true, path: configPath, content };
    } catch (error) {
      console.error('fs:getProjectConfig failed:', error);
      return { success: false, error: 'Failed to read config file' };
    }
  },

  saveProjectConfig: async (args: { projectPath: string; content: string }) => {
    try {
      const { projectPath, content } = args;
      if (!projectPath || !fs.existsSync(projectPath))
        return { success: false, error: 'Invalid project path' };
      try {
        JSON.parse(content);
      } catch {
        return { success: false, error: 'Invalid JSON format' };
      }
      const configPath = path.join(projectPath, '.emdash.json');
      fs.writeFileSync(configPath, content, 'utf8');
      return { success: true, path: configPath };
    } catch (error) {
      console.error('fs:saveProjectConfig failed:', error);
      return { success: false, error: 'Failed to save config file' };
    }
  },
});
