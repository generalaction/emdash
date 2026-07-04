import type { AttachmentRef } from '../models/attachments';

export interface StoredAttachment {
  ref: AttachmentRef;
  data: Uint8Array;
}

export interface AttachmentStore {
  put(input: { data: Uint8Array; name?: string; mimeType: string; originalPath?: string }): Promise<AttachmentRef>;
  get(id: string): Promise<StoredAttachment | null>;
  delete(id: string): Promise<void>;
}
