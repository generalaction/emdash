import type {
  AttachmentMimeType,
  AttachmentRef,
  ImageAttachmentMimeType,
} from '@emdash/core/runtimes/acp/api/client';
import type { AcpAttachmentUploadInput } from './acp-chat-store';

const UNKNOWN_FILE_MIME_TYPE = 'application/octet-stream';
const supportedAttachmentMimeTypes = new Set<ImageAttachmentMimeType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const attachmentMimeTypeByExtension: Record<string, ImageAttachmentMimeType> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type AcpAttachmentUploader = {
  uploadAttachment(input: AcpAttachmentUploadInput): Promise<AttachmentRef | null>;
};

export type BrowserDroppedFile = Pick<File, 'name' | 'size' | 'stream' | 'type'>;

function toAttachmentMimeTypeValue(value: string): ImageAttachmentMimeType | null {
  const mimeType = value.toLowerCase();
  return supportedAttachmentMimeTypes.has(mimeType as ImageAttachmentMimeType)
    ? (mimeType as ImageAttachmentMimeType)
    : null;
}

export function toAcpImageAttachmentMimeType(
  file: Pick<BrowserDroppedFile, 'name' | 'type'>
): ImageAttachmentMimeType | null {
  const declaredMimeType = toAttachmentMimeTypeValue(file.type);
  if (declaredMimeType) return declaredMimeType;
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? (attachmentMimeTypeByExtension[extension] ?? null) : null;
}

export function shouldUseAcpImageAttachment(
  file: Pick<BrowserDroppedFile, 'name' | 'type'>
): boolean {
  return toAcpImageAttachmentMimeType(file) !== null;
}

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
