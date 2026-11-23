import type { ImageAttachmentMimeType } from '@emdash/core/runtimes/acp/api/client';

const supportedImageMimeTypes = new Set<ImageAttachmentMimeType>([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
]);
const imageMimeTypeByExtension: Record<string, ImageAttachmentMimeType> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export function toAcpImageAttachmentMimeType(
  file: Pick<File, 'name' | 'type'>
): ImageAttachmentMimeType | null {
  const declared = file.type.toLowerCase();
  if (supportedImageMimeTypes.has(declared as ImageAttachmentMimeType)) {
    return declared as ImageAttachmentMimeType;
  }
  const extension = file.name.split('.').pop()?.toLowerCase();
  return extension ? (imageMimeTypeByExtension[extension] ?? null) : null;
}
