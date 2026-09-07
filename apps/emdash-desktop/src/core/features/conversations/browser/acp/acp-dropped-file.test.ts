import { describe, expect, it, vi } from 'vitest';
import {
  droppedFileMimeType,
  shouldUseAcpImageAttachment,
  toAcpImageAttachmentMimeType,
  uploadDroppedFile,
  type BrowserDroppedFile,
} from './acp-dropped-file';

describe('ACP dropped files', () => {
  it('streams Desktop file bytes to the target Host', async () => {
    const source = new ReadableStream<Uint8Array>();
    const uploadAttachment = vi.fn(async () => ({
      id: 'attachment-1',
      name: 'notes.txt',
      mimeType: 'text/plain',
      targetPath: '/host/state/acp-attachments/objects/attachment-1',
    }));
    const file = {
      name: 'notes.txt',
      type: 'text/plain',
      size: 12,
      stream: () => source,
    } as BrowserDroppedFile;

    await uploadDroppedFile({ uploadAttachment }, file);

    expect(uploadAttachment).toHaveBeenCalledWith({
      source,
      size: 12,
      mimeType: 'text/plain',
      name: 'notes.txt',
    });
  });

  it('uses a binary MIME type when the browser does not declare one', () => {
    expect(droppedFileMimeType({ type: '' })).toBe('application/octet-stream');
  });

  it.each([
    ['diagram.svg', ''],
    ['photo.avif', 'application/octet-stream'],
    ['scan.tiff', 'image/tiff'],
  ])('routes unsupported image %s as a regular file', (name, type) => {
    const file = { name, type };

    expect(toAcpImageAttachmentMimeType(file)).toBeNull();
    expect(shouldUseAcpImageAttachment(file)).toBe(false);
  });

  it.each([
    ['photo.png', ''],
    ['photo.jpg', 'application/octet-stream'],
    ['clipboard-image', 'image/webp'],
  ])('routes supported image %s as an ACP image attachment', (name, type) => {
    expect(shouldUseAcpImageAttachment({ name, type })).toBe(true);
  });
});
