import { err, ok, type Result } from '@emdash/shared';
import { KeyedMutex } from '@emdash/shared/concurrency';
import type { Logger } from '@emdash/shared/logger';
import type { WireFile } from '@emdash/wire/rpc';
import type { AttachmentError, AttachmentOwner, AttachmentRef } from '../api';
import type { AttachmentStore, StoredAttachment } from './attachment-store';

/** One instance per owning runtime: owner deletion and publication share a lock. */
export class OwnedAttachments {
  private readonly locks = new KeyedMutex();

  constructor(
    private readonly options: {
      kind: AttachmentOwner['kind'];
      store: AttachmentStore;
      exists: (id: string) => boolean;
      logger: Logger;
    }
  ) {}

  async upload(
    id: string,
    file: WireFile,
    signal?: AbortSignal
  ): Promise<Result<AttachmentRef, AttachmentError>> {
    if (!this.options.exists(id)) {
      file.cancel();
      return this.missing(id);
    }
    try {
      const staged = await this.options.store.stage(this.owner(id), file, signal);
      try {
        const result = await this.withOwner(id, async () => {
          signal?.throwIfAborted();
          return staged.publish();
        });
        if (signal?.aborted) {
          if (result.success) await this.delete(id, result.data.id);
          signal.throwIfAborted();
        }
        return result;
      } finally {
        await staged.dispose();
      }
    } catch (error) {
      if (signal?.aborted) signal.throwIfAborted();
      return this.failed(error);
    }
  }

  async download(
    id: string,
    attachmentId: string
  ): Promise<Result<StoredAttachment, AttachmentError>> {
    const result = await this.withOwner(id, () =>
      this.options.store.get(this.owner(id), attachmentId)
    );
    if (!result.success) return result;
    return result.data
      ? ok(result.data)
      : err({
          type: 'attachment-not-found',
          message: `Attachment '${attachmentId}' was not found`,
        });
  }

  delete(id: string, attachmentId: string): Promise<Result<void, AttachmentError>> {
    return this.withOwner(id, () => this.options.store.delete(this.owner(id), attachmentId));
  }

  async deleteOwner(
    id: string,
    removeRecord: () => void | boolean | Promise<void | boolean>
  ): Promise<void> {
    await this.locks.runExclusive(id, async () => {
      if ((await removeRecord()) === false) return;
      try {
        await this.options.store.deleteOwner(this.owner(id));
      } catch (error) {
        this.options.logger.warn('Owner attachment cleanup failed', {
          owner: this.owner(id),
          error,
        });
      }
    });
  }

  private withOwner<T>(id: string, work: () => Promise<T>): Promise<Result<T, AttachmentError>> {
    return this.locks.runExclusive(id, async () => {
      if (!this.options.exists(id)) return this.missing(id);
      try {
        return ok(await work());
      } catch (error) {
        return this.failed(error);
      }
    });
  }

  private owner(id: string): AttachmentOwner {
    return { kind: this.options.kind, id };
  }
  private missing(id: string): Result<never, AttachmentError> {
    return err({ type: 'owner-not-found', message: `${this.options.kind} '${id}' does not exist` });
  }
  private failed(error: unknown): Result<never, AttachmentError> {
    return err({
      type: 'storage-failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
}
