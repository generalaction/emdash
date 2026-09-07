import { mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { AttachmentMimeType, AttachmentRef } from '#runtimes/acp/api';
import type {
  AttachmentStore,
  StoredAttachment,
} from '#runtimes/acp/node/runtime/attachment-store';

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

/**
 * Per-conversation layout (spec §3.6): `<root>/conversations/<conversationId>/` holds that
 * conversation's `index.json` and copied bytes under `objects/`, so conversation deletion is
 * one recursive directory removal. Pre-v8 flat-keyed attachments (`<root>/index.json`,
 * `<root>/objects/`) are orphaned and left inert — no migration by design.
 */
export class LocalAttachmentStore implements AttachmentStore {
  private readonly conversationsDir: string;
  private readonly conversations = new Map<string, ConversationAttachmentStore>();

  constructor(rootDir: string) {
    this.conversationsDir = join(rootDir, 'conversations');
  }

  async put(input: {
    conversationId: string;
    data: Uint8Array;
    name?: string;
    mimeType: AttachmentMimeType;
  }): Promise<AttachmentRef> {
    return this.forConversation(input.conversationId).put(input);
  }

  async get(conversationId: string, attachmentId: string): Promise<StoredAttachment | null> {
    return this.forConversation(conversationId).get(attachmentId);
  }

  async delete(conversationId: string, attachmentId: string): Promise<void> {
    return this.forConversation(conversationId).delete(attachmentId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    assertSafePathSegment(conversationId);
    this.conversations.delete(conversationId);
    await rm(join(this.conversationsDir, conversationId), { recursive: true, force: true });
  }

  private forConversation(conversationId: string): ConversationAttachmentStore {
    assertSafePathSegment(conversationId);
    let store = this.conversations.get(conversationId);
    if (!store) {
      store = new ConversationAttachmentStore(join(this.conversationsDir, conversationId));
      this.conversations.set(conversationId, store);
    }
    return store;
  }
}

/** Conversation ids are wire input used as a path segment; refuse anything path-like. */
function assertSafePathSegment(conversationId: string): void {
  if (
    conversationId.length === 0 ||
    conversationId === '.' ||
    conversationId === '..' ||
    conversationId.includes('/') ||
    conversationId.includes('\\') ||
    conversationId.includes('\0')
  ) {
    throw new Error(`Invalid conversation id for attachment storage: '${conversationId}'`);
  }
}

class ConversationAttachmentStore {
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
    data: Uint8Array;
    name?: string;
    mimeType: AttachmentMimeType;
  }): Promise<AttachmentRef> {
    await this.ensureLoaded();
    const id = crypto.randomUUID();
    await mkdir(this.objectsDir, { recursive: true, mode: 0o700 });
    const storedPath = join(this.objectsDir, `${id}${safeFileExtension(input.name)}`);
    const ref: AttachmentRef = {
      id,
      name: input.name ?? 'attachment',
      mimeType: input.mimeType,
      targetPath: storedPath,
    };

    await writeFile(storedPath, input.data, { mode: 0o600 });
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
        ref: record.ref.targetPath ? record.ref : { ...record.ref, targetPath: path },
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
      await mkdir(this.rootDir, { recursive: true, mode: 0o700 });
      const tmpPath = `${this.indexPath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(tmpPath, JSON.stringify([...this.records.values()], null, 2), {
        mode: 0o600,
      });
      await rename(tmpPath, this.indexPath);
    });
    return this.persistQueue;
  }
}

function safeFileExtension(name: string | undefined): string {
  if (!name) return '';
  const extension = extname(name);
  return /^\.[a-zA-Z0-9]{1,16}$/.test(extension) ? extension : '';
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
