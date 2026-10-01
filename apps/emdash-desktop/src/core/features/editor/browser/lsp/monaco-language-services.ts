import { hostRefEquals } from '@emdash/core/primitives/host/api';
import {
  encodeResourceUri,
  formatAbsolute,
  hostFileRef,
  type HostFileRef,
} from '@emdash/core/primitives/path/api';
import type { LspState, LspLocation } from '@emdash/core/runtimes/lsp/api';
import { observable, runInAction } from 'mobx';
import type * as Monaco from 'monaco-editor';
import { decodeFacetUri, encodeFacetUri } from '../../api/browser/facet-binder/facet-uri';
import { LanguageSession, unwrap, type LanguageClient } from './language-session';

type NavigationContext = { projectId: string; taskId: string };
type Context = { ref: HostFileRef; root: HostFileRef; navigation: NavigationContext; refs: number };
type TrackedModel = {
  model: Monaco.editor.ITextModel;
  context: Context;
  session: LanguageSession;
  release: () => Promise<void>;
  change: Monaco.IDisposable;
};
const OWNER = 'emdash-lsp';

/** Bridges Monaco models and providers. Buffer lifetime, not pane lifetime, owns didOpen/didClose. */
export class MonacoLanguageServices {
  private readonly clientId = crypto.randomUUID();
  private readonly editors = new WeakMap<Monaco.editor.ICodeEditor, NavigationContext>();
  private readonly contexts = new Map<string, Context>();
  private readonly models = new Map<string, TrackedModel>();
  private readonly sessions = new Map<string, LanguageSession>();
  private readonly states = observable.map<string, LspState>({}, { deep: false });
  private readonly subscriptions: Monaco.IDisposable[] = [];
  private disposed = false;

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly options: {
      client: () => Promise<LanguageClient>;
      openLocation(
        context: NavigationContext,
        ref: HostFileRef,
        range: Monaco.IRange
      ): boolean | Promise<boolean>;
    }
  ) {
    const selector = ['typescript', 'javascript'].map((language) => ({
      language,
      scheme: 'emdash-buffer',
    }));
    this.subscriptions.push(
      monaco.editor.onDidCreateModel((model) => this.track(model)),
      monaco.editor.onWillDisposeModel((model) => this.untrack(model)),
      monaco.languages.registerHoverProvider(selector, {
        provideHover: (model, position, token) => this.hover(model, position, token),
      }),
      monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: (model, position, token) =>
          this.locations('definition', model, position, token),
      }),
      monaco.languages.registerTypeDefinitionProvider(selector, {
        provideTypeDefinition: (model, position, token) =>
          this.locations('typeDefinition', model, position, token),
      }),
      monaco.languages.registerReferenceProvider(selector, {
        provideReferences: (model, position, _context, token) =>
          this.locations('references', model, position, token),
      }),
      monaco.editor.registerEditorOpener({
        openCodeEditor: (source, target, selection) => {
          const tracked = source.getModel() && this.models.get(source.getModel()!.uri.toString());
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

  status(ref: HostFileRef): LspState | undefined {
    const context = this.contexts.get(encodeFacetUri(ref, { kind: 'buffer' }));
    return context ? this.states.get(encodeResourceUri(context.root)) : undefined;
  }

  async restart(ref: HostFileRef): Promise<void> {
    const tracked = this.models.get(encodeFacetUri(ref, { kind: 'buffer' }));
    await tracked?.session.restart();
  }

  async saved(ref: HostFileRef): Promise<void> {
    const tracked = this.models.get(encodeFacetUri(ref, { kind: 'buffer' }));
    await tracked?.session.saved(ref.path);
  }

  async hover(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken
  ): Promise<Monaco.languages.Hover | null> {
    return this.query(model, position, token, async (client, input, signal) => {
      const value = unwrap(await client.hover(input, { signal }));
      return value
        ? {
            contents: [{ value: value.contents, isTrusted: false }],
            range: value.range && toMonacoRange(value.range),
          }
        : null;
    });
  }

  async locations(
    kind: 'definition' | 'typeDefinition' | 'references',
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken
  ): Promise<Monaco.languages.Location[] | null> {
    return this.query(model, position, token, async (client, input, signal) =>
      unwrap(await client.locations({ ...input, kind }, { signal })).map((location) => ({
        uri: this.monaco.Uri.parse(
          encodeFacetUri(hostFileRef(input.session.host, location.path), { kind: 'buffer' })
        ),
        range: toMonacoRange(location.range),
      }))
    );
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const { model, change } of this.models.values()) {
      change.dispose();
      this.monaco.editor.setModelMarkers(model, OWNER, []);
    }
    this.models.clear();
    await Promise.all([...this.sessions.values()].map((session) => session.dispose()));
    this.sessions.clear();
    this.contexts.clear();
  }

  private track(model: Monaco.editor.ITextModel): void {
    if (this.disposed) return;
    const id = model.uri.toString();
    const context = this.contexts.get(id);
    const languageId = languageForPath(context?.ref);
    if (!context || !languageId || this.models.has(id)) return;
    const sessionId = encodeResourceUri(context.root);
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = new LanguageSession(
        {
          clientId: this.clientId,
          host: context.root.host,
          root: context.root.path,
          serverId: 'typescript',
        },
        this.options.client,
        (state) => this.update(sessionId, state)
      );
      this.sessions.set(sessionId, session);
    }
    const release = session.documents.track(id, () => ({
      path: context.ref.path,
      languageId,
      version: model.getVersionId(),
      text: model.getValue(),
    }));
    const activeSession = session;
    const change = model.onDidChangeContent(() => {
      this.monaco.editor.setModelMarkers(model, OWNER, []);
      activeSession.documents.changed();
    });
    this.models.set(id, { model, context, session, release, change });
  }

  private untrack(model: Monaco.editor.ITextModel): void {
    const id = model.uri.toString();
    const tracked = this.models.get(id);
    if (!tracked) return;
    this.models.delete(id);
    tracked.change.dispose();
    if (!tracked.context.refs) this.contexts.delete(id);
    void tracked
      .release()
      .catch((error) => tracked.session.fail(error))
      .then(async () => {
        if ([...this.models.values()].some((other) => other.session === tracked.session)) return;
        const key = encodeResourceUri(tracked.context.root);
        this.sessions.delete(key);
        runInAction(() => this.states.delete(key));
        await tracked.session.dispose();
      });
  }

  private update(id: string, state: LspState): void {
    if (this.disposed) return;
    runInAction(() => this.states.set(id, state));
    for (const { model, context } of this.models.values()) {
      if (encodeResourceUri(context.root) !== id) continue;
      const entry =
        state.phase === 'ready'
          ? state.diagnostics.find(
              (item) => formatAbsolute(item.path) === formatAbsolute(context.ref.path)
            )
          : undefined;
      const diagnostics =
        entry && (entry.version === undefined || entry.version === model.getVersionId())
          ? entry.diagnostics
          : [];
      this.monaco.editor.setModelMarkers(
        model,
        OWNER,
        diagnostics.map((diagnostic) => ({
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
    }
  }

  private async query<T>(
    model: Monaco.editor.ITextModel,
    position: Monaco.IPosition,
    token: Monaco.CancellationToken,
    request: (
      client: LanguageClient,
      input: Parameters<LanguageClient['hover']>[0],
      signal: AbortSignal
    ) => Promise<T>
  ): Promise<T | null> {
    const tracked = this.models.get(model.uri.toString());
    if (!tracked || token.isCancellationRequested) return null;
    const abort = new AbortController();
    const cancellation = token.onCancellationRequested(() => abort.abort());
    const version = model.getVersionId();
    try {
      await tracked.session.documents.flush();
      if (abort.signal.aborted || model.isDisposed() || version !== model.getVersionId())
        return null;
      const result = await request(
        await tracked.session.ready,
        {
          session: tracked.session.key,
          path: tracked.context.ref.path,
          version,
          position: { line: position.lineNumber - 1, character: position.column - 1 },
        },
        abort.signal
      );
      return abort.signal.aborted || model.isDisposed() || version !== model.getVersionId()
        ? null
        : result;
    } catch (error) {
      if (!abort.signal.aborted && !model.isDisposed() && version === model.getVersionId())
        tracked.session.fail(error);
      return null;
    } finally {
      cancellation.dispose();
    }
  }
}

function languageForPath(ref: HostFileRef | undefined): string | undefined {
  const extension = ref?.path.segments.at(-1)?.split('.').at(-1)?.toLowerCase();
  if (extension === 'tsx') return 'typescriptreact';
  if (extension === 'jsx') return 'javascriptreact';
  if (extension && ['ts', 'mts', 'cts'].includes(extension)) return 'typescript';
  if (extension && ['js', 'mjs', 'cjs'].includes(extension)) return 'javascript';
  return undefined;
}

function toMonacoRange(range: LspLocation['range']): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}
