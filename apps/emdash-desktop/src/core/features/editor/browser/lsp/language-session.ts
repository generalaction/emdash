import type { HostAbsolutePath } from '@emdash/core/primitives/path/api';
import type { LspState } from '@emdash/core/runtimes/lsp/api';
import type { Result } from '@emdash/shared';
import { createScope } from '@emdash/shared/concurrency';
import type { ContractClient } from '@emdash/wire/rpc';
import { observe, remote } from '@emdash/wire/state';
import { DocumentSynchronizer } from '../../api/browser/lsp/document-synchronizer';
import { editorLspContract, type EditorLspSessionKey } from '../../api/lsp-contract';

export type LanguageClient = ContractClient<typeof editorLspContract>;

/** One leased host session. Owns replication and reconnects independently of editor panes. */
export class LanguageSession {
  readonly documents: DocumentSynchronizer;
  private readyPromise?: Promise<LanguageClient>;
  private readonly scope = createScope();
  private generation?: string;
  private wireGeneration?: number;

  constructor(
    readonly key: EditorLspSessionKey,
    private readonly client: () => Promise<LanguageClient>,
    private readonly publish: (state: LspState) => void
  ) {
    this.documents = new DocumentSynchronizer({
      sync: async (document) =>
        unwrap(await (await this.ready).syncDocument({ session: key, document })),
      close: async (path) => unwrap(await (await this.ready).closeDocument({ session: key, path })),
      saved: async (path) => unwrap(await (await this.ready).saved({ session: key, path })),
      onError: (error) => this.fail(error),
    });
    void this.ready.catch((error) => this.fail(error));
  }

  get ready(): Promise<LanguageClient> {
    return (this.readyPromise ??= this.attach().catch((error: unknown) => {
      this.readyPromise = undefined;
      throw error;
    }));
  }

  async restart(): Promise<void> {
    try {
      unwrap(await (await this.ready).restart(this.key));
      this.documents.invalidate();
      await this.documents.flush();
    } catch (error) {
      this.fail(error);
    }
  }

  async saved(path: HostAbsolutePath): Promise<void> {
    try {
      await this.documents.savedPath(path);
    } catch (error) {
      this.fail(error);
    }
  }

  async dispose(): Promise<void> {
    await this.scope.dispose();
    await this.documents.dispose();
  }

  fail(error: unknown): void {
    if (this.scope.disposed) return;
    this.publish({
      phase: 'failed',
      generation: this.generation ?? '',
      capabilities: { hover: false, definition: false, typeDefinition: false, references: false },
      diagnostics: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }

  private async attach(): Promise<LanguageClient> {
    const client = await this.client();
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
          this.fail(new Error('Language server connection unavailable'));
          return;
        }
        const state = snapshot.value;
        if (!state) return;
        const changed =
          this.generation !== state.generation || this.wireGeneration !== snapshot.generation;
        this.publish(state);
        if (changed && state.phase === 'ready') {
          this.generation = state.generation;
          this.wireGeneration = snapshot.generation;
          this.documents.invalidate();
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

export function unwrap<T>(result: Result<T, { message: string }>): T {
  if (!result.success) throw new Error(result.error.message);
  return result.data;
}
