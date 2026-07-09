import { ExecError, type BoundExec } from '../../../exec';
import type { ImageReadResult } from '../schemas';

const MAX_IMAGE_BLOB_BYTES = 10 * 1024 * 1024;
const LFS_POINTER_PREFIX = Buffer.from('version https://git-lfs.github.com/spec/');
const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
};

export async function getImageBlob(
  exec: BoundExec,
  filePath: string,
  spec: string
): Promise<ImageReadResult> {
  const mimeType = imageMimeForPath(filePath);
  if (!mimeType) return { kind: 'unavailable', reason: 'unsupported' };

  let buffer: Buffer;
  try {
    const result = await exec.execBuffer(['cat-file', '--filters', spec], {
      maxBuffer: MAX_IMAGE_BLOB_BYTES,
    });
    buffer = result.stdout;
  } catch (error) {
    if (error instanceof ExecError && error.stderr.includes('maxBuffer')) {
      return { kind: 'unavailable', reason: 'too-large' };
    }
    const exitCode = error instanceof ExecError ? error.exitCode : null;
    return exitCode === 128 ? { kind: 'missing' } : { kind: 'unavailable', reason: 'git-error' };
  }

  if (buffer.length === 0) {
    return { kind: 'unavailable', reason: 'git-error' };
  }
  if (looksLikeLfsPointer(buffer)) {
    return { kind: 'unavailable', reason: 'lfs-pointer' };
  }
  return {
    kind: 'image',
    image: {
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
      mimeType,
      size: buffer.length,
    },
  };
}

export function imageMimeForPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  return ext ? (IMAGE_MIME_BY_EXT[ext] ?? null) : null;
}

export function looksLikeLfsPointer(buffer: Buffer): boolean {
  if (buffer.length > 1024) return false;
  return buffer.subarray(0, LFS_POINTER_PREFIX.length).equals(LFS_POINTER_PREFIX);
}
