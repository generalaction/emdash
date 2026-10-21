import type { WireFile } from '@emdash/wire/rpc';
import type { AttachmentOwner, AttachmentRef } from '../api';

export interface StoredAttachment {
  ref: AttachmentRef;
  source: AsyncIterable<Uint8Array>;
}

export interface StagedAttachment {
  publish(): Promise<AttachmentRef>;
  dispose(): Promise<void>;
}

/** Bytes are staged independently; the owning domain authorizes publication. */
export interface AttachmentStore {
  stage(owner: AttachmentOwner, file: WireFile, signal?: AbortSignal): Promise<StagedAttachment>;
  get(owner: AttachmentOwner, attachmentId: string): Promise<StoredAttachment | null>;
  delete(owner: AttachmentOwner, attachmentId: string): Promise<void>;
  deleteOwner(owner: AttachmentOwner): Promise<void>;
}
