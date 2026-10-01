import { formatAbsolute, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { LspDocument } from '@emdash/core/runtimes/lsp/api';

type TrackedDocument = { read: () => LspDocument; refs: number; sentVersion?: number };

/**
 * Replicates current buffers with one ordered queue. A query flushes the entire
 * session, because edits in one open file can change types in another. Reads
 * happen at send time, so rapid typing coalesces without dropping newer edits.
 */
export class DocumentSynchronizer {
  private readonly documents = new Map<string, TrackedDocument>();
  private queue: Promise<unknown> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private epoch = 0;
  private disposed = false;

  constructor(
    private readonly port: {
      sync(document: LspDocument): Promise<void>;
      close(path: HostAbsolutePath): Promise<void>;
      saved(path: HostAbsolutePath): Promise<void>;
      onError(error: unknown): void;
      delayMs?: number;
    }
  ) {}

  track(id: string, read: () => LspDocument): () => Promise<void> {
    if (this.disposed) throw new Error('Document synchronizer disposed');
    const existing = this.documents.get(id);
    const record = existing ?? { read, refs: 0 };
    record.refs += 1;
    this.documents.set(id, record);
    this.changed();
    let released = false;
    return async () => {
      if (released || this.disposed) return;
      released = true;
      record.refs -= 1;
      if (record.refs > 0) return;
      this.documents.delete(id);
      const path = record.read().path;
      await this.enqueue(() => this.port.close(path));
    };
  }

  changed(): void {
    if (this.disposed) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush().catch((error) => this.port.onError(error));
    }, this.port.delayMs ?? 120);
  }

  invalidate(): void {
    this.epoch += 1;
    for (const document of this.documents.values()) document.sentVersion = undefined;
    this.changed();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    return this.enqueue(async () => {
      for (const [id, record] of this.documents) {
        const document = record.read();
        if (record.sentVersion === document.version) continue;
        const epoch = this.epoch;
        await this.port.sync(document);
        if (epoch === this.epoch && this.documents.get(id) === record)
          record.sentVersion = document.version;
      }
    });
  }

  async saved(id: string): Promise<void> {
    await this.flush();
    const document = this.documents.get(id)?.read();
    if (document) await this.enqueue(() => this.port.saved(document.path));
  }

  async savedPath(path: HostAbsolutePath): Promise<void> {
    for (const [id, document] of this.documents) {
      if (formatAbsolute(document.read().path) === formatAbsolute(path)) await this.saved(id);
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.documents.clear();
    await this.queue.catch(() => {});
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const next = this.queue.then(async () => {
      if (this.disposed) return;
      return operation();
    });
    this.queue = next.catch(() => {});
    return next;
  }
}
