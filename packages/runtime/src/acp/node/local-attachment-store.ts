import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AttachmentMimeType, AttachmentRef } from '@emdash/core/acp';
import type { AttachmentStore, StoredAttachment } from '../runtime/attachment-store';

type AttachmentRecord = {
  ref: AttachmentRef;
  createdAt: number;
  source:
    | {
        kind: 'reference';
        originalPath: string;
        size: number;
        mtimeMs: number;
      }
    | {
        kind: 'copy';
        storedPath: string;
      };
};

export class LocalAttachmentStore implements AttachmentStore {
  private readonly indexPath: string;
  private readonly objectsDir: string;
  private readonly records = new Map<string, AttachmentRecord>();
  private loadPromise: Promise<void> | null = null;
  private persistQueue = Promise.resolve();

  constructor(private readonly rootDir: string) {
    this.indexPath = join(rootDir, 'index.json');
    this.objectsDir = join(rootDir, 'objects');
  }

  async put(input: {
    data?: Uint8Array;
    name?: string;
    mimeType: AttachmentMimeType;
    originalPath?: string;
  }): Promise<AttachmentRef> {
    await this.ensureLoaded();
    const id = crypto.randomUUID();
    const ref: AttachmentRef = {
      id,
      name: input.name ?? (input.originalPath ? basename(input.originalPath) : 'attachment'),
      mimeType: input.mimeType,
    };

    if (input.originalPath) {
      const fileStat = await stat(input.originalPath);
      this.records.set(id, {
        ref,
        createdAt: Date.now(),
        source: {
          kind: 'reference',
          originalPath: input.originalPath,
          size: fileStat.size,
          mtimeMs: fileStat.mtimeMs,
        },
      });
      await this.persist();
      return ref;
    }

    if (!input.data) {
      throw new Error('Attachment data is required when originalPath is not provided');
    }

    await mkdir(this.objectsDir, { recursive: true });
    const storedPath = join(this.objectsDir, id);
    await writeFile(storedPath, input.data);
    this.records.set(id, {
      ref,
      createdAt: Date.now(),
      source: { kind: 'copy', storedPath },
    });
    await this.persist();
    return ref;
  }

  async get(id: string): Promise<StoredAttachment | null> {
    await this.ensureLoaded();
    const record = this.records.get(id);
    if (!record) return null;
    try {
      const path =
        record.source.kind === 'reference' ? record.source.originalPath : record.source.storedPath;
      return {
        ref: record.ref,
        data: new Uint8Array(await readFile(path)),
      };
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    await this.ensureLoaded();
    const record = this.records.get(id);
    if (!record) return;
    this.records.delete(id);
    if (record.source.kind === 'copy') {
      await unlink(record.source.storedPath).catch(() => undefined);
    }
    await this.persist();
  }

  private async ensureLoaded(): Promise<void> {
    this.loadPromise ??= this.load();
    await this.loadPromise;
  }

  private async load(): Promise<void> {
    await mkdir(this.objectsDir, { recursive: true });
    let contents: string;
    try {
      contents = await readFile(this.indexPath, 'utf8');
    } catch {
      return;
    }

    const parsed: unknown = JSON.parse(contents);
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (isAttachmentRecord(value)) {
        this.records.set(value.ref.id, value);
      }
    }
  }

  private persist(): Promise<void> {
    this.persistQueue = this.persistQueue.then(async () => {
      await mkdir(this.rootDir, { recursive: true });
      const tmpPath = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, JSON.stringify([...this.records.values()], null, 2));
      await rename(tmpPath, this.indexPath);
    });
    return this.persistQueue;
  }
}

function isAttachmentRecord(value: unknown): value is AttachmentRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as AttachmentRecord;
  if (!record.ref || typeof record.ref.id !== 'string') return false;
  if (typeof record.ref.name !== 'string' || typeof record.ref.mimeType !== 'string') return false;
  if (!record.source || typeof record.source !== 'object') return false;
  if (record.source.kind === 'reference') {
    return (
      typeof record.source.originalPath === 'string' &&
      typeof record.source.size === 'number' &&
      typeof record.source.mtimeMs === 'number'
    );
  }
  return record.source.kind === 'copy' && typeof record.source.storedPath === 'string';
}
