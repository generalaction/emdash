import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageMimeForPath, readAttachmentImage } from './read-attachment-image';

describe('imageMimeForPath', () => {
  it('maps known image extensions case-insensitively', () => {
    expect(imageMimeForPath('/tmp/shot.png')).toBe('image/png');
    expect(imageMimeForPath('/tmp/SHOT.JPG')).toBe('image/jpeg');
    expect(imageMimeForPath('/tmp/anim.webp')).toBe('image/webp');
  });

  it('returns null for non-image extensions', () => {
    expect(imageMimeForPath('/tmp/a.ts')).toBeNull();
    expect(imageMimeForPath('/tmp/archive.zip')).toBeNull();
    expect(imageMimeForPath('/tmp/noext')).toBeNull();
  });
});

describe('readAttachmentImage', () => {
  it('returns a data URI for an existing image file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'emdash-attach-'));
    const path = join(dir, 'pixel.png');
    const pngBytes = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64'
    );
    await writeFile(path, pngBytes);

    const dataUri = await readAttachmentImage(path);
    expect(dataUri).toBe(`data:image/png;base64,${pngBytes.toString('base64')}`);
  });

  it('returns null for missing files, non-images, and bad paths', async () => {
    expect(await readAttachmentImage('/definitely/not/here.png')).toBeNull();
    const dir = await mkdtemp(join(tmpdir(), 'emdash-attach-'));
    const textPath = join(dir, 'notes.txt');
    await writeFile(textPath, 'hello');
    expect(await readAttachmentImage(textPath)).toBeNull();
    expect(await readAttachmentImage('')).toBeNull();
    expect(await readAttachmentImage('a\0b.png')).toBeNull();
  });
});
