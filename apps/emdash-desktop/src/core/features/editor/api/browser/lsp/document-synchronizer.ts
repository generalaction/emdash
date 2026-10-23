import { formatAbsolute, type HostAbsolutePath } from '@emdash/core/primitives/path/api';
import {
  computeDocumentEdit,
  type LspDocument,
  type LspDocumentChange,
} from '@emdash/core/runtimes/lsp/api';

export interface DocumentSource {
  path: HostAbsolutePath;
  languageId: string;
  getVersion(): number;
  getText(): string;
}
type TrackedDocument = { source: DocumentSource; refs: number; sent?: LspDocument };

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
      /** False means the host needs a fresh snapshot; other failures must reject. */
      change(change: LspDocumentChange): Promise<boolean>;
      close(path: HostAbsolutePath): Promise<void>;
      documentSaved(path: HostAbsolutePath, text: string): Promise<void>;
      onError(error: unknown): void;
      delayMs?: number;
    }
  ) {}

  track(id: string, source: DocumentSource): () => Promise<void> {
    if (this.disposed) throw new Error('Document synchronizer disposed');
    const existing = this.documents.get(id);
    const record = existing ?? { source, refs: 0 };
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
      const path = record.source.path;
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
    for (const document of this.documents.values()) document.sent = undefined;
    this.changed();
  }

  flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    return this.enqueue(async () => {
      for (const [id, record] of this.documents) {
        const version = record.source.getVersion();
        if (record.sent?.version === version) continue;
        const document = {
          path: record.source.path,
          languageId: record.source.languageId,
          version,
          text: record.source.getText(),
        };
        const epoch = this.epoch;
        const sent = record.sent;
        if (
          !sent ||
          !(await this.port.change({
            path: document.path,
            baseVersion: sent.version,
            version,
            edit: computeDocumentEdit(sent.text, document.text),
          }))
        ) {
          await this.port.sync(document);
        }
        if (epoch === this.epoch && this.documents.get(id) === record) record.sent = document;
      }
    });
  }

  async documentSaved(path: HostAbsolutePath, text: string): Promise<void> {
    await this.flush();
    const tracked = [...this.documents.values()].some(
      (document) => formatAbsolute(document.source.path) === formatAbsolute(path)
    );
    if (tracked) await this.enqueue(() => this.port.documentSaved(path, text));
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
