import { describe, expect, it } from 'vitest';
import { partitionAcpImageFiles } from './acp-image-files';

describe('partitionAcpImageFiles', () => {
  it('separates unsupported images without dropping supported images', () => {
    const tiff = new File(['chart'], 'chart.tiff', { type: 'image/tiff' });
    const png = new File(['photo'], 'photo.png', { type: 'image/png' });

    expect(partitionAcpImageFiles([tiff, png])).toEqual({
      supported: [png],
      unsupported: [tiff],
    });
  });
});
