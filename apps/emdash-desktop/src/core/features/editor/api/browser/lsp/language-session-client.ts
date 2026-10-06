import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { LspError, LspState } from '@emdash/core/runtimes/lsp/api';
import type { Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { ContractClient } from '@emdash/wire/rpc';
import { observe, remote } from '@emdash/wire/state';
import { editorLspContract, type EditorLspSessionKey } from '../../lsp-contract';
import { DocumentSynchronizer } from './document-synchronizer';

export type LanguageClient = ContractClient<typeof editorLspContract>;
export type SessionConnectionState =
  | { kind: 'connecting' }
  | { kind: 'connected'; server: LspState }
  | { kind: 'disconnected'; message: string };

/** Leases one host session. Connection state and authoritative server state stay distinct. */
export class LanguageSessionClient {
  readonly documents: DocumentSynchronizer;
  connection: SessionConnectionState = { kind: 'connecting' };
  private attachment?: Promise<LanguageClient>;
  private readonly scope = createScope();
  private generation?: string;
  private wireGeneration?: number;

  constructor(
    readonly key: EditorLspSessionKey,
    private readonly options: {
      client(): Promise<LanguageClient>;
      onState(state: SessionConnectionState): void;
      onError(error: unknown): void;
    }
  ) {
    this.documents = new DocumentSynchronizer({
      sync: async (document) =>
        unwrap(await (await this.attachedClient).setDocumentSnapshot({ session: key, document })),
      change: async (change) => {
        const result = await (
          await this.attachedClient
        ).applyDocumentEdit({ session: key, change });
        if (!result.success && result.error.type === 'document-out-of-sync') return false;
        unwrap(result);
        return true;
      },
      close: async (path) =>
        unwrap(await (await this.attachedClient).closeDocument({ session: key, path })),
      documentSaved: async (path, text) =>
        unwrap(await (await this.attachedClient).documentSaved({ session: key, path, text })),
      onError: options.onError,
    });
    void this.attachedClient.catch(() => {}); // Attachment failures are published as connection state.
  }

  /** Resolves when Wire is attached, even if the server is still starting or has failed. */
  get attachedClient(): Promise<LanguageClient> {
    return (this.attachment ??= this.attach().catch((error: unknown) => {
      this.attachment = undefined;
      this.publish({
        kind: 'disconnected',
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }));
  }

  async restartServer(): Promise<void> {
    unwrap(await (await this.attachedClient).restartServer(this.key));
    this.documents.invalidate();
    await this.documents.flush();
  }

  documentSaved(path: HostAbsolutePath, text: string): Promise<void> {
    return this.documents.documentSaved(path, text);
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
    await this.documents.dispose();
  }

  private publish(state: SessionConnectionState): void {
    if (this.scope.disposed) return;
    this.connection = state;
    this.options.onState(state);
  }

  private async attach(): Promise<LanguageClient> {
    this.publish({ kind: 'connecting' });
    const client = await this.options.client();
    if (this.scope.disposed) throw new Error('Language session disposed');
    const model = remote(editorLspContract.session, client.session, { lingerMs: 0 });
    const attachment = this.scope.child('attachment');
    attachment.add(() => model.dispose());
    attachment.add(model.retain(this.key));
    const current = model(this.key).states.current;
    observe(
      current,
      (snapshot) => {
        if (snapshot.status === 'stale' || snapshot.status === 'error') {
          this.documents.invalidate();
          this.publish({ kind: 'disconnected', message: 'Language server connection unavailable' });
          return;
        }
        const server = snapshot.value;
        if (!server) return;
        const changed =
          this.generation !== server.generation || this.wireGeneration !== snapshot.generation;
        this.publish({ kind: 'connected', server });
        if (changed && server.phase === 'ready') {
          const replacing = this.generation !== undefined || this.wireGeneration !== undefined;
          this.generation = server.generation;
          this.wireGeneration = snapshot.generation;
          if (replacing) this.documents.invalidate();
        }
      },
      { scope: attachment }
    );
    try {
      await current.refresh();
    } catch (error) {
      await attachment.dispose();
      throw error;
    }
    return client;
  }
}

export class LanguageServiceError extends Error {
  constructor(
    readonly type: LspError['type'],
    message: string
  ) {
    super(message);
  }
}
export function unwrap<T>(result: Result<T, LspError>): T {
  if (!result.success) throw new LanguageServiceError(result.error.type, result.error.message);
  return result.data;
}
