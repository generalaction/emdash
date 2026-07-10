import type { AttachmentMimeType, AttachmentRef } from '@emdash/core/acp';

export interface StoredAttachment {
  ref: AttachmentRef;
  data: Uint8Array;
}

export interface AttachmentStore {
  put(input: {
    data?: Uint8Array;
    name?: string;
    mimeType: AttachmentMimeType;
    originalPath?: string;
  }): Promise<AttachmentRef>;
  get(id: string): Promise<StoredAttachment | null>;
  delete(id: string): Promise<void>;
}
