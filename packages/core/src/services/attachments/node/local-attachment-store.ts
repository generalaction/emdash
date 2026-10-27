import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { KeyedMutex } from '@emdash/shared/concurrency';
import type { WireFile } from '@emdash/wire/rpc';
import { z } from 'zod';
import {
  attachmentMetadataSchema,
  attachmentOwnerSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentOwner,
  type AttachmentRef,
} from '../api';
import type { AttachmentStore, StagedAttachment, StoredAttachment } from './attachment-store';

const metadataSchema = attachmentMetadataSchema.extend({ id: z.uuid() });
const privateFileFlags =
  constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW;

/**
 * Host-local bytes with explicit owner namespaces. Nothing expires by age.
 * Each owner kind has exactly one store instance in one writer process. Separate
 * runtime workers may share the root only when they own disjoint kind namespaces.
 * Metadata and content become visible together through a single directory rename.
 */
export class LocalAttachmentStore implements AttachmentStore {
  private readonly locks = new KeyedMutex();
  private readonly initialization = new Map<AttachmentOwner['kind'], Promise<void>>();
  constructor(private readonly rootDir: string) {}

  /**
   * Called at worker startup, and awaited by every operation in that namespace.
   * Memoization prevents a later call from sweeping this worker's live uploads.
   * Only unpublished staging is removed; committed owner directories are untouched.
   */
  initialize(kind: AttachmentOwner['kind']): Promise<void> {
    attachmentOwnerSchema.shape.kind.parse(kind);
    let ready = this.initialization.get(kind);
    if (!ready) {
      const stagingDir = this.stagingDirectory(kind);
      ready = rm(stagingDir, { recursive: true, force: true }).then(async () => {
        await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      });
      this.initialization.set(kind, ready);
    }
    return ready;
  }

  async stage(
    owner: AttachmentOwner,
    file: WireFile,
    signal?: AbortSignal
  ): Promise<StagedAttachment> {
    attachmentOwnerSchema.parse(owner);
    const id = randomUUID();
    const stagingDir = join(this.stagingDirectory(owner.kind), this.stagingPrefix(owner) + id);
    const directory = join(this.directory(owner), id);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let ownsStaging = false;
    let cancelled = false;
    const cancel = () => {
      if (!cancelled) {
        cancelled = true;
        file.cancel();
      }
    };
    const removeStaging = async () => {
      if (ownsStaging) await rm(stagingDir, { recursive: true, force: true });
    };
    let ref: AttachmentRef;
    try {
      signal?.throwIfAborted();
      const metadata = metadataSchema.parse({ id, name: file.name, mimeType: file.mimeType });
      ref = attachmentRef(directory, metadata);
      await this.initialize(owner.kind);
      signal?.throwIfAborted();
      await mkdir(stagingDir, { mode: 0o700 });
      ownsStaging = true;
      await writeFile(join(stagingDir, 'metadata.json'), JSON.stringify(metadata), {
        flag: privateFileFlags,
        mode: 0o600,
      });
      handle = await open(join(stagingDir, contentName(metadata.name)), privateFileFlags, 0o600);
      signal?.addEventListener('abort', cancel, { once: true });
      signal?.throwIfAborted();
      let size = 0;
      for await (const chunk of file.stream()) {
        signal?.throwIfAborted();
        size += chunk.byteLength;
        if (size > MAX_ATTACHMENT_BYTES)
          throw new Error('Attachment exceeds the 50 MB upload limit.');
        let offset = 0;
        while (offset < chunk.byteLength) {
          const written = await handle.write(chunk, offset, chunk.byteLength - offset);
          if (!written.bytesWritten) throw new Error('Attachment write made no progress');
          offset += written.bytesWritten;
        }
      }
      if (file.size !== undefined && file.size !== size)
        throw new Error('Attachment size changed during upload');
      await handle.close();
      handle = undefined;
      signal?.throwIfAborted();
    } catch (error) {
      cancel();
      await handle?.close().catch(() => undefined);
      await removeStaging();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    let published = false;
    let disposed = false;
    return {
      dispose: () =>
        this.lock(owner, async () => {
          await removeStaging();
          disposed = true;
        }),
      publish: () =>
        this.lock(owner, async () => {
          if (published || disposed) throw new Error('Attachment staging is already consumed');
          signal?.throwIfAborted();
          await mkdir(this.directory(owner), { recursive: true, mode: 0o700 });
          signal?.throwIfAborted();
          // The only commit point. A worker crash leaves either a staging directory
          // to reclaim on startup or a complete attachment addressable by its id.
          await rename(stagingDir, directory);
          published = true;
          ownsStaging = false;
          if (signal?.aborted) {
            await rm(directory, { recursive: true, force: true });
            signal.throwIfAborted();
          }
          return ref;
        }),
    };
  }

  get(owner: AttachmentOwner, id: string): Promise<StoredAttachment | null> {
    return this.lock(owner, async () => {
      if (!metadataSchema.shape.id.safeParse(id).success) return null;
      const directory = join(this.directory(owner), id);
      try {
        const metadataFile = await open(
          join(directory, 'metadata.json'),
          constants.O_RDONLY | constants.O_NOFOLLOW
        );
        let metadata: z.infer<typeof metadataSchema>;
        try {
          metadata = metadataSchema.parse(JSON.parse(await metadataFile.readFile('utf8')));
          if (metadata.id !== id)
            throw new Error('Attachment metadata id does not match its directory');
        } finally {
          await metadataFile.close();
        }
        const ref = attachmentRef(directory, metadata);
        const handle = await open(ref.targetPath, constants.O_RDONLY | constants.O_NOFOLLOW);
        return { ref, source: readChunks(handle) };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      }
    });
  }

  delete(owner: AttachmentOwner, id: string): Promise<void> {
    return this.lock(owner, async () => {
      if (!metadataSchema.shape.id.safeParse(id).success) return;
      await rm(join(this.directory(owner), id), { recursive: true, force: true });
    });
  }

  deleteOwner(owner: AttachmentOwner): Promise<void> {
    return this.lock(owner, async () => {
      await rm(this.directory(owner), { recursive: true, force: true });
      const stagingDir = this.stagingDirectory(owner.kind);
      for (const name of await readdir(stagingDir)) {
        if (name.startsWith(this.stagingPrefix(owner))) {
          await rm(join(stagingDir, name), { recursive: true, force: true });
        }
      }
    });
  }

  private stagingDirectory(kind: AttachmentOwner['kind']): string {
    return join(this.rootDir, '.staging', kind);
  }
  private stagingPrefix(owner: AttachmentOwner): string {
    return Buffer.from(owner.id).toString('base64url') + '.';
  }
  private directory(owner: AttachmentOwner): string {
    return join(
      this.rootDir,
      owner.kind === 'conversation' ? 'conversations' : 'workspaces',
      owner.id
    );
  }
  private async lock<T>(owner: AttachmentOwner, work: () => Promise<T>): Promise<T> {
    attachmentOwnerSchema.parse(owner);
    await this.initialize(owner.kind);
    return this.locks.runExclusive(owner.kind + ':' + owner.id, work);
  }
}

function attachmentRef(directory: string, metadata: z.infer<typeof metadataSchema>): AttachmentRef {
  return {
    ...metadata,
    targetPath: join(directory, contentName(metadata.name)),
    pathStyle: process.platform === 'win32' ? 'win32' : 'posix',
  };
}

function contentName(name: string): string {
  const extension = extname(name);
  return 'content' + (/^\.[a-zA-Z0-9]{1,16}$/.test(extension) ? extension : '');
}

function readChunks(handle: Awaited<ReturnType<typeof open>>): AsyncIterableIterator<Uint8Array> {
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    await handle.close();
  };
  return {
    [Symbol.asyncIterator]() {
      return this;
    },
    async next() {
      if (closed) return { done: true, value: undefined };
      try {
        const buffer = new Uint8Array(64 * 1024);
        const { bytesRead } = await handle.read(buffer);
        if (bytesRead) return { done: false, value: buffer.subarray(0, bytesRead) };
        await close();
        return { done: true, value: undefined };
      } catch (error) {
        await close();
        throw error;
      }
    },
    async return() {
      await close();
      return { done: true, value: undefined };
    },
  };
}
