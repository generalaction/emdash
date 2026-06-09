import { describe, expect, it } from 'vitest';
import {
  inferDroppedBlobExtension,
  isHeicLike,
  sanitizeDroppedBlobName,
} from './persist-dropped-blob';

describe('persist-dropped-blob', () => {
  it('sanitizes unsafe file names', () => {
    expect(sanitizeDroppedBlobName('../../evil name!.png')).toBe('evil_name_.png');
  });

  it('infers extension from mime type', () => {
    expect(inferDroppedBlobExtension(undefined, 'image/heic')).toBe('.heic');
    expect(inferDroppedBlobExtension('photo.PNG', undefined)).toBe('.png');
  });

  it('detects HEIC-like inputs', () => {
    expect(isHeicLike({ name: 'shot.heic' })).toBe(true);
    expect(isHeicLike({ mimeType: 'image/heif' })).toBe(true);
    expect(isHeicLike({ name: 'shot.png', mimeType: 'image/png' })).toBe(false);
  });
});
