import { hostRefEquals } from '@emdash/core/primitives/host/api';
import { hostFileRef, type HostFileRef } from '@emdash/core/primitives/path/api';
import {
  languageServers,
  type LanguageServerDefinition,
  type LspLocation,
  type LspQuery,
} from '@emdash/core/runtimes/lsp/api';
import { waitWithSignal } from '@emdash/shared/scheduling';
import type * as Monaco from 'monaco-editor';
import { log } from '@core/primitives/logging/browser/logger';
import { decodeFacetUri, encodeFacetUri } from '../../api/browser/facet-binder/facet-uri';
import { toMonacoLanguageId } from '../../api/browser/languageUtils';
import {
  LanguageServiceClient,
  type LanguageDocumentBinding,
} from '../../api/browser/lsp/language-service-client';
import {
  LanguageServiceError,
  type LanguageClient,
} from '../../api/browser/lsp/language-session-client';
import { toMonacoRange, toProtocolPosition } from '../monaco/language-coordinates';
import { ModelDiagnostics } from '../monaco/model-diagnostics';
import { MonacoLanguageFallback, fallbackLanguageIds } from '../monaco/monaco-language-fallback';

type NavigationContext = { projectId: string; taskId: string };
type Context = { ref: HostFileRef; root: HostFileRef; navigation: NavigationContext; refs: number };
type TrackedModel = {
  model: Monaco.editor.ITextModel;
  context: Context;
  binding: LanguageDocumentBinding;
  change: Monaco.IDisposable;
};

/** Only adapts Monaco models, providers, diagnostics and navigation to language services. */
export class MonacoLanguageServices {
  private readonly editors = new WeakMap<Monaco.editor.ICodeEditor, NavigationContext>();
  private readonly contexts = new Map<string, Context>();
  private readonly models = new Map<string, TrackedModel>();
  private readonly subscriptions: Monaco.IDisposable[] = [];
  private readonly languages: LanguageServiceClient;
  private readonly local: MonacoLanguageFallback;
  private readonly diagnostics: ModelDiagnostics;
  private disposed = false;

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly options: {
      client(): Promise<LanguageClient>;
      servers?: readonly LanguageServerDefinition[];
      onError?(error: unknown): void;
      openLocation(
        context: NavigationContext,
        ref: HostFileRef,
        range: Monaco.IRange
      ): boolean | Promise<boolean>;
    }
  ) {
    this.local = new MonacoLanguageFallback(monaco);
    this.diagnostics = new ModelDiagnostics(monaco, this.local, (error) => this.report(error));
    this.languages = new LanguageServiceClient({
      ...options,
      onError: (error) => this.report(error),
    });
    const languages = new Set(
      (options.servers ?? languageServers).flatMap((server) =>
        server.languages.map((language) => toMonacoLanguageId(language.languageId))
      )
    );
    const selector = [...new Set([...fallbackLanguageIds, ...languages])].map((language) => ({
      language,
    }));
    this.subscriptions.push(
      monaco.editor.onDidCreateModel((model) => this.track(model)),
      monaco.editor.onWillDisposeModel((model) => this.untrack(model)),
      monaco.languages.registerHoverProvider(selector, {
        provideHover: (model, position, token) => this.hover(model, position, token),
      }),
      monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: (model, position, token) => this.definition(model, position, token),
      }),
      monaco.languages.registerTypeDefinitionProvider(selector, {
        provideTypeDefinition: (model, position, token) =>
          this.typeDefinition(model, position, token),
      }),
      monaco.languages.registerReferenceProvider(selector, {
        provideReferences: (model, position, context, token) =>
          this.references(model, position, context, token),
      }),
      monaco.editor.registerEditorOpener({
        openCodeEditor: (source, target, selection) => {
          const sourceModel = source.getModel();
          const tracked = sourceModel && this.models.get(sourceModel.uri.toString());
          const decoded = decodeFacetUri(target.toString());
          if (
            !tracked ||
            !decoded.success ||
            decoded.data.facet.kind !== 'buffer' ||
            !hostRefEquals(tracked.context.ref.host, decoded.data.ref.host)
          )
            return false;
          const range =
            selection && 'startLineNumber' in selection
              ? selection
              : {
                  startLineNumber: selection?.lineNumber ?? 1,
                  startColumn: selection?.column ?? 1,
                  endLineNumber: selection?.lineNumber ?? 1,
                  endColumn: selection?.column ?? 1,
                };
          return options.openLocation(
            this.editors.get(source) ?? tracked.context.navigation,
            decoded.data.ref,
            range
          );
        },
      })
    );
    for (const model of monaco.editor.getModels()) this.track(model);
  }

  /** Navigation belongs to the source pane, even when another task shares its buffer. */
  bindEditor(editor: Monaco.editor.ICodeEditor, context: NavigationContext): () => void {
    this.editors.set(editor, context);
    return () => {
      this.editors.delete(editor);
    };
  }

  registerContext(ref: HostFileRef, root: HostFileRef, navigation: NavigationContext): () => void {
    const id = encodeFacetUri(ref, { kind: 'buffer' });
    const context = this.contexts.get(id) ?? { ref, root, navigation, refs: 0 };
    context.refs += 1;
    this.contexts.set(id, context);
    const model = this.monaco.editor.getModel(this.monaco.Uri.parse(id));
    if (model) this.track(model);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      context.refs -= 1;
      if (!context.refs && !this.models.has(id)) this.contexts.delete(id);
    };
  }

  status(ref: HostFileRef) {
    const status = this.languages.status(ref);
    if (!status) return undefined;
    const model = this.models.get(encodeFacetUri(ref, { kind: 'buffer' }))?.model;
    return {
      ...status,
      fallbackAvailable: model ? fallbackLanguageIds.includes(model.getLanguageId()) : false,
    };
  }

  async restartServer(ref: HostFileRef): Promise<void> {
    try {
      await this.models.get(encodeFacetUri(ref, { kind: 'buffer' }))?.binding.restartServer();
    } catch (error) {
      this.report(error);
    }
  }

  async documentSaved(ref: HostFileRef, text: string): Promise<void> {
    try {
      await this.models.get(encodeFacetUri(ref, { kind: 'buffer' }))?.binding.documentSaved(text);
    } catch (error) {
      this.report(error);
    }
  }

  hover(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken
  ): Promise<Monaco.languages.Hover | null> {
    return this.query(
      model,
      position,
      token,
      async (binding, position, signal) => {
        const value = await binding.hover(position, signal);
        return value
          ? {
              contents: [{ value: value.contents, isTrusted: false }],
              range: value.range && toMonacoRange(value.range),
            }
          : null;
      },
      () => this.local.hover(model, position)
    );
  }

  definition(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken
  ) {
    return this.locations(
      model,
      position,
      token,
      (binding, position, signal) => binding.definition(position, signal),
      () => this.local.definition(model, position)
    );
  }
  typeDefinition(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken
  ) {
    return this.locations(model, position, token, (binding, position, signal) =>
      binding.typeDefinition(position, signal)
    );
  }
  references(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    context: Monaco.languages.ReferenceContext,
    token: Monaco.CancellationToken
  ) {
    return this.locations(
      model,
      position,
      token,
      (binding, position, signal) => binding.references(position, context, signal),
      () => this.local.references(model, position, context)
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.diagnostics.dispose();
    this.local.dispose();
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const { change } of this.models.values()) change.dispose();
    this.models.clear();
    this.contexts.clear();
    await this.languages.dispose();
  }

  private track(model: Monaco.editor.ITextModel): void {
    if (this.disposed) return;
    const id = model.uri.toString();
    const context = this.contexts.get(id);
    if (!context || this.models.has(id)) return;
    const binding = this.languages.bindDocument({
      ref: context.ref,
      workspaceRoot: context.root,
      getVersion: () => model.getVersionId(),
      getText: () => model.getValue(),
      onDiagnostics: (diagnostics) => {
        if (model.isDisposed()) return;
        this.diagnostics.publish(
          model,
          diagnostics?.map((diagnostic) => ({
            ...toMonacoRange(diagnostic.range),
            message: diagnostic.message,
            source: diagnostic.source,
            code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
            severity: [
              this.monaco.MarkerSeverity.Error,
              this.monaco.MarkerSeverity.Warning,
              this.monaco.MarkerSeverity.Info,
              this.monaco.MarkerSeverity.Hint,
            ][(diagnostic.severity ?? 1) - 1],
          }))
        );
      },
    });
    if (!binding) return;
    this.models.set(id, {
      model,
      context,
      binding,
      change: model.onDidChangeContent(() => binding.changed()),
    });
  }

  private untrack(model: Monaco.editor.ITextModel): void {
    const id = model.uri.toString();
    const tracked = this.models.get(id);
    if (!tracked) return;
    this.models.delete(id);
    tracked.change.dispose();
    if (!tracked.context.refs) this.contexts.delete(id);
    void tracked.binding.dispose().catch((error) => this.report(error));
  }

  private locations(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken,
    request: (
      binding: LanguageDocumentBinding,
      position: LspQuery['position'],
      signal: AbortSignal
    ) => Promise<LspLocation[] | null>,
    fallback?: () => Promise<Monaco.languages.Location[] | null>
  ): Promise<Monaco.languages.Location[] | null> {
    return this.query(
      model,
      position,
      token,
      async (binding, position, signal) => {
        const host = this.models.get(model.uri.toString())?.context.ref.host;
        if (!host) return null;
        return (
          (await request(binding, position, signal))?.map((location) => ({
            uri: this.monaco.Uri.parse(
              encodeFacetUri(hostFileRef(host, location.path), { kind: 'buffer' })
            ),
            range: toMonacoRange(location.range),
          })) ?? null
        );
      },
      fallback &&
        (async () => {
          const locations = await fallback();
          const source = decodeFacetUri(model.uri.toString());
          if (!source.success) return locations;
          return (
            locations?.filter((location) => {
              const target = decodeFacetUri(location.uri.toString());
              return (
                !target.success ||
                (hostRefEquals(source.data.ref.host, target.data.ref.host) &&
                  source.data.facet.kind === target.data.facet.kind)
              );
            }) ?? null
          );
        })
    );
  }

  private async query<T>(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken,
    request: (
      binding: LanguageDocumentBinding,
      position: LspQuery['position'],
      signal: AbortSignal
    ) => Promise<T>,
    fallback: () => Promise<T | null> = async () => null
  ): Promise<T | null> {
    if (token.isCancellationRequested || model.isDisposed() || this.disposed) return null;
    const version = model.getVersionId();
    const language = model.getLanguageId();
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());
    const disposal = model.onWillDispose(() => abort.abort());
    const current = () =>
      !abort.signal.aborted &&
      !this.disposed &&
      !model.isDisposed() &&
      model.getVersionId() === version &&
      model.getLanguageId() === language;
    try {
      const tracked = this.models.get(model.uri.toString());
      if (tracked) {
        try {
          const result = await request(tracked.binding, toProtocolPosition(position), abort.signal);
          return current() ? result : null;
        } catch (error) {
          if (!current()) return null;
          if (
            !(
              error instanceof LanguageServiceError &&
              (error.type === 'session-unavailable' || error.type === 'unsupported')
            )
          ) {
            this.report(error);
            return null;
          }
        }
      }
      const connection = tracked?.binding.status.connection;
      const result = await waitWithSignal(fallback(), abort.signal);
      return current() && tracked?.binding.status.connection === connection ? result : null;
    } catch (error) {
      if (current()) this.report(error);
      return null;
    } finally {
      cancellation.dispose();
      disposal.dispose();
    }
  }

  private report(error: unknown): void {
    if (this.options.onError) this.options.onError(error);
    else log.warn('Language service request failed', error);
  }
}
