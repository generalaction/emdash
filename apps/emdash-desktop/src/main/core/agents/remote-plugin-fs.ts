import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { PluginFs } from '@emdash/core/agents/plugins';
import { isFileNotFoundError, type IFileSystem } from '@emdash/core/files';
import type { IExecutionContext } from '@main/core/execution-context/types';

const MAX_PLUGIN_READ_BYTES = 2 * 1024 * 1024;

/**
 * Create a PluginFs scoped to a remote root directory.
 * All paths are resolved relative to root; path-escape attempts throw.
 */
export function createRemotePluginFs(
  ctx: IExecutionContext,
  remoteFs: IFileSystem,
  root: string
): PluginFs {
  const absRoot = normalizeRoot(root);

  function resolveSafe(value: string): string {
    const normalized = value.replace(/\\/g, '/');
    const abs = path.posix.normalize(path.posix.join(absRoot, normalized));
    const rootWithSep = absRoot.endsWith('/') ? absRoot : `${absRoot}/`;
    const absWithSep = abs.endsWith('/') ? abs : `${abs}/`;
    if (!absWithSep.startsWith(rootWithSep) && abs !== absRoot) {
      throw new Error(`Remote plugin fs: path escape attempt: ${value}`);
    }
    return abs;
  }

  return {
    async read(value: string): Promise<string | null> {
      const abs = resolveSafe(value);
      const result = await remoteFs.readText(abs, { maxBytes: MAX_PLUGIN_READ_BYTES });
      if (result.success) return result.data.content;
      if (isFileNotFoundError(result.error)) return null;
      throw new Error(`Remote plugin fs: failed to read ${abs}: ${result.error.message}`);
    },

    async write(value: string, content: string): Promise<void> {
      const abs = resolveSafe(value);
      const tmpPath = `${abs}.${randomUUID()}.tmp`;

      try {
        await ctx.exec('mkdir', ['-p', path.posix.dirname(abs)]);
        const written = await remoteFs.writeText(tmpPath, content);
        if (!written.success) throw new Error(written.error.message);
        await ctx.exec('mv', [tmpPath, abs]);
      } catch (error) {
        try {
          await ctx.exec('rm', ['-f', tmpPath]);
        } catch {}
        throw error;
      }
    },

    async delete(value: string): Promise<void> {
      await ctx.exec('rm', ['-rf', resolveSafe(value)]);
    },

    async exists(value: string): Promise<boolean> {
      const result = await remoteFs.exists(resolveSafe(value));
      return result.success ? result.data : false;
    },

    async list(value: string): Promise<string[]> {
      try {
        const { stdout } = await ctx.exec('ls', ['-A', resolveSafe(value)]);
        return stdout.split('\n').filter(Boolean);
      } catch {
        return [];
      }
    },

    async readLink(value: string): Promise<string | null> {
      const abs = resolveSafe(value);
      try {
        await ctx.exec('test', ['-L', abs]);
        const { stdout } = await ctx.exec('readlink', [abs]);
        return stdout.trim() || null;
      } catch {
        return null;
      }
    },
  };
}

function normalizeRoot(root: string): string {
  const normalized = path.posix.normalize(root.replace(/\\/g, '/'));
  if (!path.posix.isAbsolute(normalized)) {
    throw new Error(`Remote plugin fs root must be absolute: ${root}`);
  }
  return normalized;
}
