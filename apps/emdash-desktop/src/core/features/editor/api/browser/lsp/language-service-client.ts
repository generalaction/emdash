import {
  encodeResourceUri,
  formatAbsolute,
  hostFileRef,
  type HostFileRef,
} from '@emdash/core/primitives/path/api';
import {
  selectLanguageServer,
  type LanguageServerDefinition,
  type LspState,
  type LspHover,
  type LspLocation,
  type LspQuery,
} from '@emdash/core/runtimes/lsp/api';
import { waitWithSignal } from '@emdash/shared/scheduling';
import { observable, runInAction, type IObservableValue } from 'mobx';
import {
  LanguageSessionClient,
  LanguageServiceError,
  unwrap,
  type LanguageClient,
  type SessionConnectionState,
} from './language-session-client';

type Position = LspQuery['position'];
type Diagnostics = LspState['diagnostics'][number]['diagnostics'];
export interface LanguageDocumentSource {
  ref: HostFileRef;
  workspaceRoot: HostFileRef;
  getVersion(): number;
  getText(): string;
  onDiagnostics(diagnostics: Diagnostics): void;
}
export interface LanguageDocumentStatus {
  serverName: string;
  connection: SessionConnectionState;
}
export interface LanguageDocumentBinding {
  readonly status: LanguageDocumentStatus;
  changed(): void;
  documentSaved(text: string): Promise<void>;
  restartServer(): Promise<void>;
  hover(position: Position, signal?: AbortSignal): Promise<LspHover>;
  definition(position: Position, signal?: AbortSignal): Promise<LspLocation[] | null>;
  typeDefinition(position: Position, signal?: AbortSignal): Promise<LspLocation[] | null>;
  references(
    position: Position,
    options: { includeDeclaration: boolean },
    signal?: AbortSignal
  ): Promise<LspLocation[] | null>;
  dispose(): Promise<void>;
}
interface BoundDocument {
  source: LanguageDocumentSource;
  selection: NonNullable<ReturnType<typeof selectLanguageServer>>;
  lifetime: AbortController;
  attached: Promise<void>;
  state: IObservableValue<LanguageDocumentStatus>;
  session?: LanguageSessionClient;
  sessionId?: string;
  release?: () => Promise<void>;
}

/** Owns language projects and document lifetimes; callers need no session or Wire knowledge. */
export class LanguageServiceClient {
  private readonly clientId = crypto.randomUUID();
  private readonly documents = observable.map<string, BoundDocument>({}, { deep: false });
  private readonly sessions = new Map<string, LanguageSessionClient>();
  private disposed = false;

  constructor(
    private readonly options: {
      client(): Promise<LanguageClient>;
      onError(error: unknown): void;
      servers?: readonly LanguageServerDefinition[];
    }
  ) {}

  status(ref: HostFileRef): LanguageDocumentStatus | undefined {
    return this.documents.get(encodeResourceUri(ref))?.state.get();
  }

  bindDocument(source: LanguageDocumentSource): LanguageDocumentBinding | undefined {
    if (this.disposed) throw new Error('Language service client disposed');
    const selection = selectLanguageServer(
      source.ref.path.segments.at(-1) ?? '',
      this.options.servers
    );
    if (!selection) return undefined;
    const id = encodeResourceUri(source.ref);
    if (this.documents.has(id)) throw new Error('Document is already bound');
    const record: BoundDocument = {
      source,
      selection,
      lifetime: new AbortController(),
      attached: Promise.resolve(),
      state: observable.box(
        { serverName: selection.server.name, connection: { kind: 'connecting' } },
        { deep: false }
      ),
    };
    runInAction(() => this.documents.set(id, record));
    record.attached = this.attach(record);
    return {
      get status() {
        return record.state.get();
      },
      changed: () => {
        if (record.lifetime.signal.aborted) return;
        source.onDiagnostics([]);
        record.session?.documents.changed();
      },
      documentSaved: async (text) => {
        await record.attached;
        if (!record.lifetime.signal.aborted)
          await record.session?.documentSaved(source.ref.path, text);
      },
      restartServer: async () => {
        const attachment = record.attached;
        await attachment;
        if (record.lifetime.signal.aborted) return;
        if (record.session) await record.session.restartServer();
        else {
          if (record.attached === attachment) record.attached = this.attach(record);
          await record.attached;
        }
      },
      hover: (position, signal) =>
        this.query(record, position, signal, (client, input, signal) =>
          client.hover(input, { signal }).then(unwrap)
        ),
      definition: (position, signal) =>
        this.query(record, position, signal, (client, input, signal) =>
          client.definition(input, { signal }).then(unwrap)
        ),
      typeDefinition: (position, signal) =>
        this.query(record, position, signal, (client, input, signal) =>
          client.typeDefinition(input, { signal }).then(unwrap)
        ),
      references: (position, options, signal) =>
        this.query(record, position, signal, (client, input, signal) =>
          client.references({ ...input, ...options }, { signal }).then(unwrap)
        ),
      dispose: () => this.release(record),
    };
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const record of this.documents.values()) {
      record.lifetime.abort();
      record.source.onDiagnostics([]);
    }
    runInAction(() => this.documents.clear());
    await Promise.all([...this.sessions.values()].map((session) => session.dispose()));
    this.sessions.clear();
  }

  private async attach(record: BoundDocument): Promise<void> {
    const { source, selection, lifetime } = record;
    this.update(record, { kind: 'connecting' });
    try {
      const client = await this.options.client();
      if (lifetime.signal.aborted) return;
      const root = unwrap(
        await client.resolveProjectRoot(
          {
            host: source.ref.host,
            workspaceRoot: source.workspaceRoot.path,
            path: source.ref.path,
            serverId: selection.server.id,
          },
          { signal: lifetime.signal }
        )
      );
      if (lifetime.signal.aborted) return;
      const sessionId = JSON.stringify([
        encodeResourceUri(hostFileRef(source.ref.host, root)),
        selection.server.id,
      ]);
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = new LanguageSessionClient(
          { clientId: this.clientId, host: source.ref.host, root, serverId: selection.server.id },
          {
            client: this.options.client,
            onError: this.options.onError,
            onState: (state) => {
              for (const other of this.documents.values())
                if (other.sessionId === sessionId) this.update(other, state);
            },
          }
        );
        this.sessions.set(sessionId, session);
      }
      record.sessionId = sessionId;
      record.session = session;
      record.release = session.documents.track(encodeResourceUri(source.ref), {
        path: source.ref.path,
        languageId: selection.language.languageId,
        getVersion: () => source.getVersion(),
        getText: () => source.getText(),
      });
      this.update(record, session.connection);
    } catch (error) {
      if (!lifetime.signal.aborted)
        this.update(record, {
          kind: 'disconnected',
          message: error instanceof Error ? error.message : String(error),
        });
    }
  }

  private update(record: BoundDocument, connection: SessionConnectionState): void {
    if (record.lifetime.signal.aborted) return;
    runInAction(() => record.state.set({ serverName: record.selection.server.name, connection }));
    const server = connection.kind === 'connected' ? connection.server : undefined;
    const entry =
      server?.phase === 'ready'
        ? server.diagnostics.find(
            (item) => formatAbsolute(item.path) === formatAbsolute(record.source.ref.path)
          )
        : undefined;
    record.source.onDiagnostics(
      entry && (entry.version === undefined || entry.version === record.source.getVersion())
        ? entry.diagnostics
        : []
    );
  }

  private async release(record: BoundDocument): Promise<void> {
    if (record.lifetime.signal.aborted) return;
    record.lifetime.abort();
    runInAction(() => this.documents.delete(encodeResourceUri(record.source.ref)));
    record.source.onDiagnostics([]);
    const { session, sessionId } = record;
    if (!session || !sessionId) return;
    try {
      await record.release?.();
    } finally {
      if (![...this.documents.values()].some((other) => other.session === session)) {
        if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
        await session.dispose();
      }
    }
  }

  private async query<T>(
    record: BoundDocument,
    position: Position,
    signal: AbortSignal | undefined,
    request: (
      client: LanguageClient,
      input: Parameters<LanguageClient['hover']>[0],
      signal: AbortSignal
    ) => Promise<T>
  ): Promise<T | null> {
    const abort = signal
      ? AbortSignal.any([signal, record.lifetime.signal])
      : record.lifetime.signal;
    if (abort.aborted) return null;
    const version = record.source.getVersion();
    try {
      abort.throwIfAborted();
      // Discovery may still be attaching an unsaved sibling to this project.
      await waitWithSignal(
        Promise.all(
          [...this.documents.values()]
            .filter(
              (other) =>
                other.selection.server.id === record.selection.server.id &&
                encodeResourceUri(other.source.workspaceRoot) ===
                  encodeResourceUri(record.source.workspaceRoot)
            )
            .map((other) => other.attached)
        ),
        abort
      );
      const session = record.session;
      if (!session) return null;
      await waitWithSignal(session.documents.flush(), abort);
      if (version !== record.source.getVersion()) return null;
      const client = await waitWithSignal(session.attachedClient, abort);
      const result = await waitWithSignal(
        request(
          client,
          { session: session.key, path: record.source.ref.path, version, position },
          abort
        ),
        abort
      );
      return version === record.source.getVersion() ? result : null;
    } catch (error) {
      if (
        abort.aborted ||
        version !== record.source.getVersion() ||
        (error instanceof LanguageServiceError &&
          (error.type === 'cancelled' || error.type === 'stale-query'))
      )
        return null;
      throw error;
    }
  }
}
