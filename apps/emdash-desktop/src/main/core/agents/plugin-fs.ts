import { promises as fs } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import type { PluginFs } from '@emdash/shared/agents/plugins';

/**
 * Create a CLIAgentPluginFs scoped to a given root directory.
 * All paths are resolved relative to root; path-escape attempts throw.
 */
export function createPluginFs(root: string): PluginFs {
  const absRoot = resolve(root);

  function resolveSafe(path: string): string {
    const abs = resolve(join(absRoot, path));
    const rootWithSep = absRoot.endsWith(sep) ? absRoot : absRoot + sep;
    const absWithSep = abs.endsWith(sep) ? abs : abs + sep;
    if (!absWithSep.startsWith(rootWithSep) && abs !== absRoot) {
      throw new Error(`Plugin fs: path escape attempt: ${path}`);
    }
    return abs;
  }

  return {
    async read(path: string): Promise<string | null> {
      try {
        return await fs.readFile(resolveSafe(path), 'utf-8');
      } catch {
        return null;
      }
    },

    async write(path: string, content: string): Promise<void> {
      const abs = resolveSafe(path);
      await fs.mkdir(dirname(abs), { recursive: true });
      await fs.writeFile(abs, content, 'utf-8');
    },

    async delete(path: string): Promise<void> {
      try {
        await fs.unlink(resolveSafe(path));
      } catch {
        // Silently ignore if file doesn't exist
      }
    },

    async exists(path: string): Promise<boolean> {
      try {
        await fs.access(resolveSafe(path));
        return true;
      } catch {
        return false;
      }
    },

    async list(path: string): Promise<string[]> {
      try {
        return await fs.readdir(resolveSafe(path));
      } catch {
        return [];
      }
    },
  };
}
