import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, open, readFile, readdir, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { KeyedMutex } from '@emdash/shared/concurrency';
import type { WireFile } from '@emdash/wire/rpc';
import {
  attachmentOwnerSchema,
  MAX_ATTACHMENT_BYTES,
  type AttachmentOwner,
  type AttachmentRef,
} from '../api';
import type { AttachmentStore, StagedAttachment, StoredAttachment } from './attachment-store';

type AttachmentRecord = {
  ref: AttachmentRef;
  createdAt: number;
  source: { kind: 'copy'; storedPath: string };
};

/**
 * Host-local bytes with explicit owner namespaces. Nothing expires by age.
 * Each owner kind has exactly one writer process. Locks are process-local; separate
 * runtime workers may share the root only when they own disjoint kind namespaces.
 */
export class LocalAttachmentStore implements AttachmentStore {
  private readonly owners = new Map<string, OwnerStore>();
  private readonly locks = new KeyedMutex();
  constructor(private readonly rootDir: string) {}

  async stage(
    owner: AttachmentOwner,
    file: WireFile,
    signal?: AbortSignal
  ): Promise<StagedAttachment> {
    attachmentOwnerSchema.parse(owner);
    const id = randomUUID();
    const stagingDir = join(this.rootDir, '.staging');
    const partialPath = join(stagingDir, `${this.stagingPrefix(owner)}${id}.partial`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    let cancelled = false;
    const cancel = () => {
      if (!cancelled) {
        cancelled = true;
        file.cancel();
      }
    };
    const dispose = () =>
      unlink(partialPath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error;
      });
    try {
      signal?.throwIfAborted();
      await mkdir(stagingDir, { recursive: true, mode: 0o700 });
      handle = await open(
        partialPath,
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        0o600
      );
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
      await dispose();
      throw error;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
    let published = false;
    return {
      dispose,
      publish: () =>
        this.lock(owner, async (store) => {
          if (published) throw new Error('Attachment was already published');
          signal?.throwIfAborted();
          const ref = await store.publish({
            id,
            name: file.name,
            mimeType: file.mimeType,
            partialPath,
            signal,
          });
          published = true;
          return ref;
        }),
    };
  }

  get(owner: AttachmentOwner, id: string): Promise<StoredAttachment | null> {
    return this.lock(owner, (store) => store.get(id));
  }
  delete(owner: AttachmentOwner, id: string): Promise<void> {
    return this.lock(owner, (store) => store.delete(id));
  }
  deleteOwner(owner: AttachmentOwner): Promise<void> {
    attachmentOwnerSchema.parse(owner);
    return this.locks.runExclusive(this.key(owner), async () => {
      this.owners.delete(this.key(owner));
      await rm(this.directory(owner), { recursive: true, force: true });
      const stagingDir = join(this.rootDir, '.staging');
      const staged = await readdir(stagingDir).catch((error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      for (const name of staged) {
        if (name.startsWith(this.stagingPrefix(owner)) && name.endsWith('.partial')) {
          await rm(join(stagingDir, name), { force: true });
        }
      }
    });
  }
  private stagingPrefix(owner: AttachmentOwner): string {
    return `${owner.kind}-${Buffer.from(owner.id).toString('base64url')}.`;
  }
  private key(owner: AttachmentOwner): string {
    return `${owner.kind}:${owner.id}`;
  }
  private directory(owner: AttachmentOwner): string {
    return join(
      this.rootDir,
      owner.kind === 'conversation' ? 'conversations' : 'workspaces',
      owner.id
    );
  }
  private lock<T>(owner: AttachmentOwner, work: (store: OwnerStore) => Promise<T>): Promise<T> {
    attachmentOwnerSchema.parse(owner);
    return this.locks.runExclusive(this.key(owner), () => {
      let store = this.owners.get(this.key(owner));
      if (!store) {
        store = new OwnerStore(this.directory(owner));
        this.owners.set(this.key(owner), store);
      }
      return work(store);
    });
  }
}

class OwnerStore {
  private readonly indexPath: string;
  private readonly objectsDir: string;
  private records: Map<string, AttachmentRecord> | undefined;
  constructor(private readonly rootDir: string) {
    this.indexPath = join(rootDir, 'index.json');
    this.objectsDir = join(rootDir, 'objects');
  }

  async publish(input: {
    id: string;
    name: string;
    mimeType: string;
    partialPath: string;
    signal?: AbortSignal;
  }): Promise<AttachmentRef> {
    const records = await this.load();
    const storedPath = join(this.objectsDir, `${input.id}${safeFileExtension(input.name)}`);
    const ref: AttachmentRef = {
      id: input.id,
      name: input.name,
      mimeType: input.mimeType,
      targetPath: storedPath,
      pathStyle: process.platform === 'win32' ? 'win32' : 'posix',
    };
    const next = new Map(records);
    next.set(ref.id, { ref, createdAt: Date.now(), source: { kind: 'copy', storedPath } });
    let committed = false;
    try {
      await mkdir(this.objectsDir, { recursive: true, mode: 0o700 });
      input.signal?.throwIfAborted();
      await rename(input.partialPath, storedPath);
      input.signal?.throwIfAborted();
      await this.persist(next);
      committed = true;
      input.signal?.throwIfAborted();
      this.records = next;
      return ref;
    } catch (error) {
      if (committed) await this.persist(records).catch(() => undefined);
      await unlink(storedPath).catch(() => undefined);
      throw error;
    }
  }

  async get(id: string): Promise<StoredAttachment | null> {
    const record = (await this.load()).get(id);
    if (!record) return null;
    try {
      const handle = await open(
        record.source.storedPath,
        constants.O_RDONLY | constants.O_NOFOLLOW
      );
      let closed = false;
      const close = async () => {
        if (closed) return;
        closed = true;
        await handle.close();
      };
      const source: AsyncIterableIterator<Uint8Array> = {
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
      return { ref: record.ref, source };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  async delete(id: string): Promise<void> {
    const records = await this.load();
    const record = records.get(id);
    if (!record) return;
    await rm(record.source.storedPath, { force: true });
    const next = new Map(records);
    next.delete(id);
    await this.persist(next);
    this.records = next;
  }
  private async load(): Promise<Map<string, AttachmentRecord>> {
    if (this.records) return this.records;
    let contents: string;
    try {
      contents = await readFile(this.indexPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return (this.records = new Map());
    }
    const parsed: unknown = JSON.parse(contents);
    if (!Array.isArray(parsed)) throw new Error('Invalid attachment index');
    const records = new Map<string, AttachmentRecord>();
    for (const value of parsed) {
      if (isAttachmentRecord(value))
        records.set(value.ref.id, {
          ...value,
          ref: { ...value.ref, pathStyle: process.platform === 'win32' ? 'win32' : 'posix' },
        });
    }
    return (this.records = records);
  }
  private async persist(records: Map<string, AttachmentRecord>): Promise<void> {
    const temporary = `${this.indexPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify([...records.values()]), {
        mode: 0o600,
        flag: 'wx',
      });
      await rename(temporary, this.indexPath);
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

function safeFileExtension(name: string): string {
  const extension = extname(name);
  return /^\.[a-zA-Z0-9]{1,16}$/.test(extension) ? extension : '';
}
function isAttachmentRecord(value: unknown): value is AttachmentRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as AttachmentRecord;
  return (
    typeof record.ref?.id === 'string' &&
    typeof record.ref.name === 'string' &&
    typeof record.ref.mimeType === 'string' &&
    typeof record.ref.targetPath === 'string' &&
    record.source?.kind === 'copy' &&
    typeof record.source.storedPath === 'string'
  );
}
