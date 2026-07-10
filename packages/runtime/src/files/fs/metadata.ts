import path from 'node:path';

export const DEFAULT_MAX_BYTES = 200 * 1024;
export const MAX_READ_BYTES = 100 * 1024 * 1024;

export function normalizeMaxBytes(maxBytes: number | undefined): number {
  if (maxBytes === undefined) return DEFAULT_MAX_BYTES;
  return Math.min(Math.max(0, Math.floor(maxBytes)), MAX_READ_BYTES);
}

export function etagForStat(stat: { mtimeMs: number; size: number }): string {
  return `${Math.floor(stat.mtimeMs).toString(29)}-${stat.size.toString(31)}`;
}

export function mimeTypeForPath(filePath: string): string | undefined {
  switch (path.extname(filePath).toLowerCase()) {
    case '.avif':
      return 'image/avif';
    case '.gif':
      return 'image/gif';
    case '.jpeg':
    case '.jpg':
      return 'image/jpeg';
    case '.json':
      return 'application/json';
    case '.pdf':
      return 'application/pdf';
    case '.png':
      return 'image/png';
    case '.svg':
      return 'image/svg+xml';
    case '.webp':
      return 'image/webp';
    default:
      return undefined;
  }
}
