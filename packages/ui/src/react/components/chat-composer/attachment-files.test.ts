import { describe, expect, it } from 'vitest';
import { imageFilesFromClipboard } from './attachment-files';

function clipboardItem(file: File | null, kind = 'file'): DataTransferItem {
  return {
    kind,
    type: file?.type ?? 'text/plain',
    getAsFile: () => file,
  } as DataTransferItem;
}

describe('imageFilesFromClipboard', () => {
  it('returns pasted image files and ignores other clipboard items', () => {
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const items = [clipboardItem(image), clipboardItem(text), clipboardItem(null, 'string')];

    expect(
      imageFilesFromClipboard({
        items: items as unknown as DataTransferItemList,
        types: ['Files'],
      })
    ).toEqual([image]);
  });

  it('selects one preferred representation for an image clipboard payload', () => {
    const tiff = new File(['tiff'], 'screenshot.tiff', { type: 'image/tiff' });
    const png = new File(['png'], 'screenshot.png', { type: 'image/png' });

    expect(
      imageFilesFromClipboard({
        items: [clipboardItem(tiff), clipboardItem(png)] as unknown as DataTransferItemList,
        types: ['image/tiff', 'image/png'],
      })
    ).toEqual([png]);
  });
});
