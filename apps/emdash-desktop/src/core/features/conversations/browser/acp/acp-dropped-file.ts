import type { AttachmentMimeType, AttachmentRef } from '@emdash/core/runtimes/acp/api/client';
import type { AcpAttachmentUploadInput } from './acp-chat-store';

const UNKNOWN_FILE_MIME_TYPE = 'application/octet-stream';

export type AcpAttachmentUploader = {
  uploadAttachment(input: AcpAttachmentUploadInput): Promise<AttachmentRef | null>;
};

export type BrowserDroppedFile = Pick<File, 'name' | 'size' | 'stream' | 'type'>;

export function droppedFileMimeType(file: Pick<BrowserDroppedFile, 'type'>): AttachmentMimeType {
  return file.type.trim().toLowerCase() || UNKNOWN_FILE_MIME_TYPE;
}

/** Snapshot Desktop-owned bytes into the ACP runtime on the target Host. */
export function uploadDroppedFile(
  uploader: AcpAttachmentUploader,
  file: BrowserDroppedFile,
  mimeType: AttachmentMimeType = droppedFileMimeType(file)
): Promise<AttachmentRef | null> {
  return uploader.uploadAttachment({
    source: file.stream(),
    size: file.size,
    mimeType,
    name: file.name || 'attachment',
  });
}
