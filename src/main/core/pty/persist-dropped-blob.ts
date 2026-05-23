import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import { promisify } from 'node:util';
import { app, clipboard, nativeImage } from 'electron';

export const MAX_DROPPED_BLOB_BYTES = 50 * 1024 * 1024;

const execFileAsync = promisify(execFile);

const MIME_TO_EXT: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

export function sanitizeDroppedBlobName(name: string | undefined): string {
  if (!name) return '';
  const base = basename(name).replace(/[^A-Za-z0-9._-]/g, '_');
  return base.slice(0, 64);
}

export function inferDroppedBlobExtension(
  name: string | undefined,
  mimeType: string | undefined
): string {
  const fromName = name ? extname(name).toLowerCase() : '';
  if (fromName) return fromName;
  if (mimeType && MIME_TO_EXT[mimeType.toLowerCase()]) return MIME_TO_EXT[mimeType.toLowerCase()];
  return '.bin';
}

export function isHeicLike(args: { name?: string; mimeType?: string; ext?: string }): boolean {
  const ext = args.ext ?? inferDroppedBlobExtension(args.name, args.mimeType);
  if (ext === '.heic' || ext === '.heif') return true;
  const mime = args.mimeType?.toLowerCase() ?? '';
  return mime.includes('heic') || mime.includes('heif');
}

/**
 * Claude Code and most vision models cannot read HEIC directly. macOS clipboard
 * and drag sources often supply HEIC — convert to PNG before persisting.
 */
export async function normalizeDroppedImageBytes(
  bytes: Uint8Array,
  args: { name?: string; mimeType?: string }
): Promise<{ bytes: Uint8Array; ext: string }> {
  const ext = inferDroppedBlobExtension(args.name, args.mimeType);
  if (!isHeicLike({ ...args, ext })) {
    return { bytes, ext };
  }

  const image = nativeImage.createFromBuffer(Buffer.from(bytes));
  if (!image.isEmpty()) {
    const png = image.toPNG();
    if (png.byteLength > 0) return { bytes: new Uint8Array(png), ext: '.png' };
  }

  return { bytes: await convertHeicLikeBytesToPng(bytes, ext), ext: '.png' };
}

async function convertHeicLikeBytesToPng(bytes: Uint8Array, ext: string): Promise<Uint8Array> {
  if (process.platform !== 'darwin') {
    throw new Error('HEIC/HEIF image conversion is only supported on macOS');
  }

  const tempDir = await mkdtemp(join(app.getPath('temp'), 'emdash-heic-'));
  const inputPath = join(tempDir, `input${ext === '.heif' ? '.heif' : '.heic'}`);
  const outputPath = join(tempDir, 'output.png');

  try {
    await writeFile(inputPath, bytes);
    await execFileAsync('/usr/bin/sips', ['-s', 'format', 'png', inputPath, '--out', outputPath]);
    const png = await readFile(outputPath);
    if (png.byteLength === 0) throw new Error('sips produced an empty PNG');
    return new Uint8Array(png);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to convert HEIC/HEIF image to PNG: ${message}`);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function persistDroppedBlobBytes(args: {
  bytes: Uint8Array;
  name?: string;
  mimeType?: string;
}): Promise<string> {
  if (args.bytes.byteLength > MAX_DROPPED_BLOB_BYTES) {
    throw new Error(`Dropped file is too large (${args.bytes.byteLength} bytes)`);
  }

  const normalized = await normalizeDroppedImageBytes(args.bytes, {
    name: args.name,
    mimeType: args.mimeType,
  });
  const safe = sanitizeDroppedBlobName(args.name?.replace(/\.[^.]+$/, ''));
  const filename = `emdash-drop-${randomUUID()}${safe ? `-${safe}` : ''}${normalized.ext}`;
  const fullPath = join(app.getPath('temp'), filename);
  await writeFile(fullPath, normalized.bytes);
  return fullPath;
}

/** Read a raster image from the OS clipboard and persist it as PNG. */
export async function persistClipboardImagePath(): Promise<string | null> {
  const image = clipboard.readImage();
  if (image.isEmpty()) return null;
  const png = image.toPNG();
  if (png.byteLength === 0) return null;
  return persistDroppedBlobBytes({
    bytes: new Uint8Array(png),
    name: 'paste.png',
    mimeType: 'image/png',
  });
}
