import { readFile, stat } from 'node:fs/promises';
import { extname } from 'node:path';

/** Renderer thumbnails refuse anything bigger than this. */
export const MAX_ATTACHMENT_IMAGE_BYTES = 8 * 1024 * 1024;

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

export function imageMimeForPath(path: string): string | null {
  return IMAGE_MIME_BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

/**
 * Read an image the user attached to a native chat message and return it as a
 * data URI for thumbnail rendering. Returns null (never throws) for paths
 * that are missing, not images by extension, or too large — the renderer
 * falls back to a plain file chip.
 */
export async function readAttachmentImage(path: string): Promise<string | null> {
  if (typeof path !== 'string' || !path.trim() || path.includes('\0')) return null;
  const mime = imageMimeForPath(path);
  if (!mime) return null;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_ATTACHMENT_IMAGE_BYTES) return null;
    const bytes = await readFile(path);
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch {
    return null;
  }
}
