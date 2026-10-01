import { randomUUID } from 'node:crypto';
import type {
  Position,
  ServerCapabilities,
  TextDocumentItem,
} from 'vscode-languageserver-protocol';
import { z } from 'zod';
import { applyDocumentEdit, positionAtOffset } from '../api/document-edits';
import { lspDiagnosticSchema, type LspDocumentEdit } from '../api/schemas';

export class StaleQueryError extends Error {}

export class DocumentOutOfSyncError extends Error {
  constructor() {
    super('Document synchronization requires a fresh snapshot');
  }
}

/** Process/JSON-RPC boundary. A session owns exactly one transport generation. */
export interface LanguageServerTransport {
  readonly initializationOptions?: unknown;
  request(method: string, params: unknown, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  onNotification(listener: (method: string, params: unknown) => void): () => void;
  onClose(listener: () => void): () => void;
  dispose(): Promise<void>;
}

const diagnosticsSchema = z.object({
  uri: z.string(),
  version: z.number().int().optional(),
  diagnostics: z.array(lspDiagnosticSchema),
});
export type ProtocolDiagnostics = z.infer<typeof diagnosticsSchema>;

export interface ServerSessionState {
  phase: 'starting' | 'ready' | 'failed';
  generation: string;
  capabilities: ServerCapabilities;
  diagnostics: ProtocolDiagnostics[];
  error?: string;
}

/**
 * Owns initialization, ordered document replication and generation fencing.
 * Query responses do not occupy the document queue: a slow hover must not stop
 * typing, closing a document, or cancelling another request.
 */
export class LanguageServerSession {
  current: ServerSessionState = {
    phase: 'starting',
    generation: '',
    capabilities: {},
    diagnostics: [],
  };
  private readonly documents = new Map<string, TextDocumentItem>();
  private readonly lifetime = new AbortController();
  private transport?: LanguageServerTransport;
  private starting?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private disposePromise?: Promise<void>;
  private detach: Array<() => void> = [];

  constructor(
    private readonly options: {
      rootUri: string;
      connect: () => Promise<LanguageServerTransport>;
      onState?: (state: ServerSessionState) => void;
      initializationOptions?: unknown;
    }
  ) {}

  start(): Promise<void> {
    if (this.lifetime.signal.aborted)
      return Promise.reject(new Error('Language server session disposed'));
    if (this.transport && this.current.phase === 'ready') return Promise.resolve();
    return (this.starting ??= this.initialize().finally(() => {
      this.starting = undefined;
    }));
  }

  setDocumentSnapshot(document: TextDocumentItem): Promise<void> {
    return this.enqueue(async () => {
      await this.start();
      await this.writeDocument(document);
    });
  }

  applyDocumentEdit(change: {
    uri: string;
    baseVersion: number;
    version: number;
    edit: LspDocumentEdit;
  }): Promise<void> {
    return this.enqueue(async () => {
      await this.start();
      const previous = this.documents.get(change.uri);
      if (
        !previous ||
        previous.version !== change.baseVersion ||
        change.version <= change.baseVersion
      )
        throw new DocumentOutOfSyncError();
      const text = applyDocumentEdit(previous.text, change.edit);
      await this.writeDocument({ ...previous, version: change.version, text }, change.edit);
    });
  }

  private async writeDocument(document: TextDocumentItem, edit?: LspDocumentEdit): Promise<void> {
    const previous = this.documents.get(document.uri);
    if (previous && document.version <= previous.version) {
      if (
        document.version === previous.version &&
        document.text === previous.text &&
        document.languageId === previous.languageId
      )
        return;
      throw new Error('Document version is stale or has conflicting content');
    }
    const transport = this.requireTransport();
    this.documents.set(document.uri, { ...document });
    this.clearDiagnostics(document.uri);
    try {
      if (!previous) {
        await transport.notify('textDocument/didOpen', { textDocument: document });
      } else if (previous.languageId !== document.languageId) {
        await transport.notify('textDocument/didClose', { textDocument: { uri: document.uri } });
        await transport.notify('textDocument/didOpen', { textDocument: document });
      } else {
        const sync = this.current.capabilities.textDocumentSync;
        const kind = typeof sync === 'number' ? sync : sync?.change;
        if (kind !== 1 && kind !== 2)
          throw new Error('Language server does not support document changes');
        const change =
          kind === 1
            ? { text: document.text }
            : {
                range: edit
                  ? {
                      start: positionAtOffset(previous.text, edit.start),
                      end: positionAtOffset(previous.text, edit.start + edit.deleteCount),
                    }
                  : { start: { line: 0, character: 0 }, end: endPosition(previous.text) },
                text: edit?.text ?? document.text,
              };
        await transport.notify('textDocument/didChange', {
          textDocument: { uri: document.uri, version: document.version },
          contentChanges: [change],
        });
      }
    } catch (error) {
      if (previous) this.documents.set(document.uri, previous);
      else this.documents.delete(document.uri);
      throw error;
    }
  }

  closeDocument(uri: string): Promise<void> {
    return this.enqueue(async () => {
      if (!this.documents.delete(uri)) return;
      this.clearDiagnostics(uri);
      if (this.transport && this.current.phase === 'ready') {
        await this.transport.notify('textDocument/didClose', { textDocument: { uri } });
      }
    });
  }

  documentSaved(uri: string): Promise<void> {
    return this.enqueue(async () => {
      const document = this.documents.get(uri);
      const sync = this.current.capabilities.textDocumentSync;
      const save = typeof sync === 'object' ? sync.save : undefined;
      if (!document || !save || !this.transport) return;
      await this.transport.notify('textDocument/didSave', {
        textDocument: { uri },
        ...(typeof save === 'object' && save.includeText ? { text: document.text } : {}),
      });
    });
  }

  async query(
    method: string,
    uri: string,
    version: number,
    position: Position,
    signal?: AbortSignal,
    context?: { includeDeclaration: boolean }
  ): Promise<unknown> {
    const transport = await this.enqueue(async () => {
      signal?.throwIfAborted();
      await this.start();
      if (this.documents.get(uri)?.version !== version)
        throw new StaleQueryError('Query document version is not synchronized');
      return this.requireTransport();
    });
    const generation = this.current.generation;
    const result = await transport.request(
      method,
      {
        textDocument: { uri },
        position,
        ...(context ? { context } : {}),
      },
      signal
    );
    if (
      this.lifetime.signal.aborted ||
      this.transport !== transport ||
      generation !== this.current.generation ||
      this.documents.get(uri)?.version !== version
    ) {
      throw new StaleQueryError('Query document version or server generation changed');
    }
    return result;
  }

  restartServer(): Promise<void> {
    return this.enqueue(async () => {
      await this.starting?.catch(() => {});
      await this.stopTransport();
      this.publish({
        ...this.current,
        phase: 'starting',
        diagnostics: [],
        capabilities: {},
        error: undefined,
      });
      await this.start();
    });
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.lifetime.abort(new Error('Language server session disposed'));
    this.disposePromise = (async () => {
      await this.starting?.catch(() => {});
      await this.queue.catch(() => {});
      await this.stopTransport();
      this.documents.clear();
    })();
    return this.disposePromise;
  }

  private async initialize(): Promise<void> {
    const generation = randomUUID();
    this.publish({ phase: 'starting', generation, capabilities: {}, diagnostics: [] });
    try {
      const transport = await this.options.connect();
      if (this.lifetime.signal.aborted) {
        await transport.dispose();
        throw new Error('Language server session disposed');
      }
      this.transport = transport;
      this.detach = [
        transport.onNotification((method, params) => {
          if (this.transport !== transport || this.current.generation !== generation) return;
          if (method === 'textDocument/publishDiagnostics') this.receiveDiagnostics(params);
        }),
        transport.onClose(() => {
          if (this.transport !== transport || this.lifetime.signal.aborted) return;
          this.disconnectListeners();
          this.transport = undefined;
          void transport.dispose().catch(() => {});
          this.publish({
            phase: 'failed',
            generation,
            capabilities: {},
            diagnostics: [],
            error: 'Language server exited. Restart language services to reconnect.',
          });
        }),
      ];
      const result = await transport.request(
        'initialize',
        {
          processId: process.pid,
          rootUri: this.options.rootUri,
          workspaceFolders: [{ uri: this.options.rootUri, name: 'workspace' }],
          clientInfo: { name: 'Emdash' },
          capabilities: {
            general: { positionEncodings: ['utf-16'] },
            workspace: { applyEdit: false, configuration: true, workspaceFolders: true },
            textDocument: {
              synchronization: { dynamicRegistration: false, didSave: true },
              hover: { contentFormat: ['markdown', 'plaintext'] },
              definition: { linkSupport: true },
              typeDefinition: { linkSupport: true },
              publishDiagnostics: { versionSupport: true, relatedInformation: false },
            },
          },
          initializationOptions:
            this.options.initializationOptions ?? transport.initializationOptions,
        },
        this.lifetime.signal
      );
      const parsed = z.object({ capabilities: z.record(z.string(), z.unknown()) }).parse(result);
      const capabilities = parsed.capabilities as ServerCapabilities;
      if (capabilities.positionEncoding && capabilities.positionEncoding !== 'utf-16')
        throw new Error('Unsupported language server position encoding');
      await transport.notify('initialized', {});
      for (const document of this.documents.values())
        await transport.notify('textDocument/didOpen', { textDocument: document });
      if (this.transport !== transport || this.lifetime.signal.aborted)
        throw new Error('Language server session disposed or disconnected');
      this.publish({ ...this.current, phase: 'ready', capabilities });
    } catch (error) {
      await this.stopTransport(false);
      this.publish({
        phase: 'failed',
        generation,
        capabilities: {},
        diagnostics: [],
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private receiveDiagnostics(params: unknown): void {
    const parsed = diagnosticsSchema.safeParse(params);
    if (!parsed.success) return;
    const diagnostics = parsed.data;
    const document = this.documents.get(diagnostics.uri);
    if (
      !document ||
      (diagnostics.version !== undefined && diagnostics.version !== document.version)
    )
      return;
    this.publish({
      ...this.current,
      diagnostics: [
        ...this.current.diagnostics.filter((d) => d.uri !== diagnostics.uri),
        diagnostics,
      ],
    });
  }

  private clearDiagnostics(uri: string): void {
    this.publish({
      ...this.current,
      diagnostics: this.current.diagnostics.filter((d) => d.uri !== uri),
    });
  }

  private publish(state: ServerSessionState): void {
    this.current = state;
    this.options.onState?.(state);
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(() => {
      if (this.lifetime.signal.aborted) throw new Error('Language server session disposed');
      return operation();
    });
    this.queue = result.catch(() => {});
    return result;
  }

  private requireTransport(): LanguageServerTransport {
    if (!this.transport) throw new Error('Language server disconnected');
    return this.transport;
  }

  private disconnectListeners(): void {
    for (const dispose of this.detach) dispose();
    this.detach = [];
  }

  private async stopTransport(graceful = true): Promise<void> {
    const transport = this.transport;
    this.transport = undefined;
    this.disconnectListeners();
    if (!transport) return;
    try {
      if (graceful) {
        await transport.request('shutdown', null, AbortSignal.timeout(1_000));
        await transport.notify('exit', undefined);
      }
    } catch {
    } finally {
      await transport.dispose();
    }
  }
}

function endPosition(text: string): Position {
  const lines = text.split(/\r\n|\r|\n/);
  return { line: lines.length - 1, character: lines.at(-1)?.length ?? 0 };
}
