import path from 'node:path';
import type { IFileSystem } from '@emdash/core/files';
import { ok } from '@emdash/shared';
import { fileErrorToMessage } from './file-errors';

export const ALLOWED_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.ico',
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;

export async function readWorkspaceImage(fileSystem: IFileSystem, filePath: string) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_IMAGE_EXTENSIONS.has(ext)) {
    return ok({
      success: false as const,
      error: `Unsupported image format: ${ext}. Allowed: ${Array.from(ALLOWED_IMAGE_EXTENSIONS).join(', ')}`,
    });
  }

  const result = await fileSystem.readBytes(filePath, { maxBytes: MAX_IMAGE_SIZE });
  if (!result.success) {
    return ok({ success: false as const, error: fileErrorToMessage(result.error) });
  }
  if (result.data.truncated) {
    return ok({
      success: false as const,
      error: `Image too large: ${result.data.totalSize} bytes (max ${MAX_IMAGE_SIZE})`,
    });
  }

  const mimeType = IMAGE_MIME_TYPES[ext] || 'application/octet-stream';
  const base64 = Buffer.from(result.data.bytes).toString('base64');
  return ok({
    success: true as const,
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
    size: result.data.totalSize,
  });
}
