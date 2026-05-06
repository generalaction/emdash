import type { ManagedFileKind } from './types';

/** Raster image extensions — rendered with <img>, not Monaco. */
export const RASTER_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'ico', 'bmp']);

/**
 * Known binary / non-text extensions — shown as "unsupported" instead of
 * attempting to load into Monaco.
 */
export const BINARY_EXTS = new Set([
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
  'zip',
  'tar',
  'gz',
  'bz2',
  '7z',
  'rar',
  'pdf',
  'db',
  'sqlite',
  'sqlite3',
  'class',
  'jar',
  'pyc',
  'o',
  'a',
  'lib',
  'bin',
  'dat',
  'pkg',
  'dmg',
  'iso',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  'mp3',
  'mp4',
  'wav',
  'ogg',
  'webm',
  'mov',
  'avi',
]);

/**
 * Determine the kind of a file purely from its extension, with no I/O.
 * Returns everything except `'too-large'`, which is set after reading the file
 * and checking the `truncated` flag from the FS layer.
 */
export function getFileKind(filePath: string): Exclude<ManagedFileKind, 'too-large'> {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  if (RASTER_EXTS.has(ext)) return 'image';
  if (ext === 'svg') return 'svg';
  if (ext === 'md' || ext === 'mdx') return 'markdown';
  if (BINARY_EXTS.has(ext)) return 'binary';
  return 'text';
}

/** True for file kinds that default to rendered/preview mode. */
export function isPreviewableKind(kind: ManagedFileKind): boolean {
  return kind === 'svg' || kind === 'markdown';
}

/**
 * Returns true if the file should be treated as binary for diff views.
 * Binary and image files cannot be shown in Monaco; callers should skip
 * model registration and show a "Binary file" placeholder instead.
 */
export function isBinaryForDiff(filePath: string): boolean {
  const kind = getFileKind(filePath);
  return kind === 'binary' || kind === 'image';
}
