import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

type ListArgs = {
  root: string;
  includeDirs?: boolean;
  maxEntries?: number;
};

type Item = {
  path: string; // relative to root
  type: 'file' | 'dir';
};

const DEFAULT_IGNORES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.cache',
  'coverage',
  '.DS_Store',
]);

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

function safeStat(p: string): fs.Stats | null {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

function listFiles(root: string, includeDirs: boolean, maxEntries: number): Item[] {
  const items: Item[] = [];
  const stack: string[] = ['.'];

  while (stack.length > 0) {
    const rel = stack.pop() as string;
    const abs = path.join(root, rel);

    const stat = safeStat(abs);
    if (!stat) continue;

    if (stat.isDirectory()) {
      const name = path.basename(abs);
      if (rel !== '.' && DEFAULT_IGNORES.has(name)) continue;

      if (rel !== '.' && includeDirs) {
        items.push({ path: rel, type: 'dir' });
        if (items.length >= maxEntries) break;
      }

      let entries: string[] = [];
      try {
        entries = fs.readdirSync(abs);
      } catch {
        continue;
      }

      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (DEFAULT_IGNORES.has(entry)) continue;
        const nextRel = rel === '.' ? entry : path.join(rel, entry);
        stack.push(nextRel);
      }
    } else if (stat.isFile()) {
      items.push({ path: rel, type: 'file' });
      if (items.length >= maxEntries) break;
    }
  }

  return items;
}

export function registerFsIpc(): void {
  ipcMain.handle('fs:list', async (_event, args: ListArgs) => {
    try {
      const root = args.root;
      const includeDirs = args.includeDirs ?? true;
      const maxEntries = Math.min(Math.max(args.maxEntries ?? 5000, 100), 20000);
      if (!root || !fs.existsSync(root)) {
        return { success: false, error: 'Invalid root path' };
      }
      const items = listFiles(root, includeDirs, maxEntries);
      return { success: true, items };
    } catch (error) {
      console.error('fs:list failed:', error);
      return { success: false, error: 'Failed to list files' };
    }
  });

  ipcMain.handle(
    'fs:read',
    async (_event, args: { root: string; relPath: string; maxBytes?: number }) => {
      try {
        const { root, relPath } = args;
        const maxBytes = Math.min(Math.max(args.maxBytes ?? 200 * 1024, 1024), 5 * 1024 * 1024); // 200KB default, clamp 1KB..5MB
        if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
        if (!relPath) return { success: false, error: 'Invalid relPath' };

        // Resolve and ensure within root
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
    }
  );

  // Save an attachment (e.g., image) into a workspace-managed folder
  ipcMain.handle(
    'fs:save-attachment',
    async (_event, args: { workspacePath: string; srcPath: string; subdir?: string }) => {
      try {
        const { workspacePath, srcPath } = args;
        if (!workspacePath || !fs.existsSync(workspacePath))
          return { success: false, error: 'Invalid workspacePath' };
        if (!srcPath || !fs.existsSync(srcPath))
          return { success: false, error: 'Invalid srcPath' };

        const ext = path.extname(srcPath).toLowerCase();
        if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
          return { success: false, error: 'Unsupported attachment type' };
        }

        const baseDir = path.join(
          workspacePath,
          '.emdash',
          args.subdir || DEFAULT_ATTACHMENTS_SUBDIR
        );
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

        // Copy file
        fs.copyFileSync(srcPath, destAbs);

        const relFromWorkspace = path.relative(workspacePath, destAbs);
        return {
          success: true,
          absPath: destAbs,
          relPath: relFromWorkspace,
          fileName: destName,
        };
      } catch (error) {
        console.error('fs:save-attachment failed:', error);
        return { success: false, error: 'Failed to save attachment' };
      }
    }
  );

  // Write a file relative to a root (creates parent directories)
  ipcMain.handle(
    'fs:write',
    async (
      _event,
      args: { root: string; relPath: string; content: string; mkdirs?: boolean }
    ) => {
      try {
        const { root, relPath, content, mkdirs = true } = args;
        if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
        if (!relPath) return { success: false, error: 'Invalid relPath' };

        const abs = path.resolve(root, relPath);
        const normRoot = path.resolve(root) + path.sep;
        if (!abs.startsWith(normRoot)) return { success: false, error: 'Path escapes root' };

        const dir = path.dirname(abs);
        if (mkdirs) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(abs, content, 'utf8');
        return { success: true };
      } catch (error) {
        console.error('fs:write failed:', error);
        return { success: false, error: 'Failed to write file' };
      }
    }
  );

  // Remove a file relative to a root
  ipcMain.handle(
    'fs:remove',
    async (_event, args: { root: string; relPath: string }) => {
      try {
        const { root, relPath } = args;
        if (!root || !fs.existsSync(root)) return { success: false, error: 'Invalid root path' };
        if (!relPath) return { success: false, error: 'Invalid relPath' };
        const abs = path.resolve(root, relPath);
        const normRoot = path.resolve(root) + path.sep;
        if (!abs.startsWith(normRoot)) return { success: false, error: 'Path escapes root' };
        if (!fs.existsSync(abs)) return { success: true };
        const st = safeStat(abs);
        if (st && st.isDirectory()) return { success: false, error: 'Is a directory' };
        fs.unlinkSync(abs);
        return { success: true };
      } catch (error) {
        console.error('fs:remove failed:', error);
        return { success: false, error: 'Failed to remove file' };
      }
    }
  );
}
