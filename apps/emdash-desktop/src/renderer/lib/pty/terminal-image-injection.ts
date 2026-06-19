import { toast } from 'sonner';
import { rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';
import { isHeicLikeFile, isUnstableDropPath } from './terminal-image-paths';

const MAX_DROPPED_BLOB_BYTES = 50 * 1024 * 1024;

export async function resolveDroppedFile(file: File): Promise<string | null> {
  const originalPath = window.electronAPI.getPathForFile(file).trim();
  const isHeicLike = isHeicLikeFile(file);
  if (originalPath && !isUnstableDropPath(originalPath) && !isHeicLike) {
    return originalPath;
  }
  if (file.size > MAX_DROPPED_BLOB_BYTES) {
    log.warn('Dropped file is too large to persist', { size: file.size, name: file.name });
    if (isHeicLike) {
      toast.error('HEIC image is too large', {
        description: 'Use an image under 50 MB or convert it to PNG manually.',
        duration: 5000,
      });
    }
    return null;
  }

  const conversionToastId = isHeicLike
    ? toast.loading('Converting HEIC image...', {
        description: 'Preparing a PNG for the terminal',
        duration: Infinity,
      })
    : null;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await rpc.pty.persistDroppedBlob({
      bytes,
      name: file.name,
      mimeType: file.type,
    });
    if (result.success) {
      if (conversionToastId !== null) {
        toast.success('HEIC image converted', {
          id: conversionToastId,
          description: 'Ready to send to the agent',
          duration: 4000,
        });
      }
      return result.data.path;
    }
    log.warn('Dropped file persist failed', { error: result.error });
  } catch (error) {
    log.warn('Dropped file arrayBuffer failed', { error });
  }
  if (conversionToastId !== null) {
    toast.error('Could not convert HEIC image', {
      id: conversionToastId,
      description: 'Try converting it to PNG manually and drop it again.',
      duration: 5000,
    });
  }
  return null;
}
