import { describe, expect, it } from 'vitest';
import { clipboardHasText, imageFilesFromClipboard } from './attachment-files';

function clipboardItem(
  file: File | null,
  kind = 'file',
  type = file?.type ?? 'text/plain'
): DataTransferItem {
  return {
    kind,
    type,
    getAsFile: () => file,
  } as DataTransferItem;
}

function clipboardData(items: DataTransferItem[]) {
  return {
    items: items as unknown as DataTransferItemList,
  };
}

describe('imageFilesFromClipboard', () => {
  it('detects text content that should continue to the editor', () => {
    expect(clipboardHasText({ types: ['Files', 'text/html'] })).toBe(true);
    expect(clipboardHasText({ types: ['Files', 'image/png'] })).toBe(false);
  });

  it('returns pasted image files and ignores other clipboard items', () => {
    const image = new File(['image'], 'screenshot.png', { type: 'image/png' });
    const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const items = [clipboardItem(image), clipboardItem(text), clipboardItem(null, 'string')];

    expect(imageFilesFromClipboard(clipboardData(items))).toEqual([image]);
  });

  it('keeps every image file exposed by the clipboard', () => {
    const tiff = new File(['tiff'], 'screenshot.tiff', { type: 'image/tiff' });
    const png = new File(['png'], 'screenshot.png', { type: 'image/png' });

    expect(
      imageFilesFromClipboard(clipboardData([clipboardItem(tiff), clipboardItem(png)]))
    ).toEqual([tiff, png]);
  });

  it('keeps multiple independent images of the same type', () => {
    const first = new File(['first'], 'first.png', { type: 'image/png' });
    const second = new File(['second'], 'second.png', { type: 'image/png' });

    expect(
      imageFilesFromClipboard(clipboardData([clipboardItem(first), clipboardItem(second)]))
    ).toEqual([first, second]);
  });

  it('keeps same-stem images with different supported types', () => {
    const png = new File(['png'], 'image.png', { type: 'image/png' });
    const jpeg = new File(['jpeg'], 'image.jpg', { type: 'image/jpeg' });

    expect(
      imageFilesFromClipboard(clipboardData([clipboardItem(png), clipboardItem(jpeg)]))
    ).toEqual([png, jpeg]);
  });

  it('keeps unsupported images when no supported representation exists', () => {
    const tiff = new File(['tiff'], 'image.tiff', { type: 'image/tiff' });

    expect(imageFilesFromClipboard(clipboardData([clipboardItem(tiff)]))).toEqual([tiff]);
  });

  it('keeps separate supported and unsupported images', () => {
    const tiff = new File(['chart'], 'chart.tiff', { type: 'image/tiff' });
    const png = new File(['photo'], 'photo.png', { type: 'image/png' });

    expect(
      imageFilesFromClipboard(clipboardData([clipboardItem(tiff), clipboardItem(png)]))
    ).toEqual([tiff, png]);
  });

  it('recognizes image files with generic clipboard MIME types by extension', () => {
    const heic = new File(['heic'], 'photo.heic', { type: 'application/octet-stream' });

    expect(imageFilesFromClipboard(clipboardData([clipboardItem(heic, 'file', '')]))).toEqual([
      heic,
    ]);
  });
});
