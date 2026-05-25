import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { isHeicLikeFile, isUnstableDropPath } from './terminal-image-paths';

const MAX_DROPPED_BLOB_BYTES = 50 * 1024 * 1024;

export async function resolveDroppedFile(file: File): Promise<string | null> {
  const originalPath = window.electronAPI.getPathForFile(file).trim();
  if (originalPath && !isUnstableDropPath(originalPath) && !isHeicLikeFile(file)) {
    return originalPath;
  }
  if (file.size > MAX_DROPPED_BLOB_BYTES) {
    log.warn('Dropped file is too large to persist', { size: file.size, name: file.name });
    return null;
  }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await rpc.pty.persistDroppedBlob({
      bytes,
      name: file.name,
      mimeType: file.type,
    });
    if (result.success) return result.data.path;
    log.warn('Dropped file persist failed', { error: result.error });
  } catch (error) {
    log.warn('Dropped file arrayBuffer failed', { error });
  }
  return null;
}
