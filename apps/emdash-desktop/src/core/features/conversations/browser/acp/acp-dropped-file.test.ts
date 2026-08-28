import { describe, expect, it, vi } from 'vitest';
import {
  droppedFileMimeType,
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
});
