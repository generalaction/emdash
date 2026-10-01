import { hostRefEquals } from '@emdash/core/primitives/host/api';
import {
  encodeResourceUri,
  formatAbsolute,
  hostFileRef,
  type HostFileRef,
} from '@emdash/core/primitives/path/api';
import {
  languageServers,
  selectLanguageServer,
  type LanguageServerDefinition,
  type LspState,
  type LspLocation,
} from '@emdash/core/runtimes/lsp/api';
import { observable, runInAction } from 'mobx';
import type * as Monaco from 'monaco-editor';
import { decodeFacetUri, encodeFacetUri } from '../../api/browser/facet-binder/facet-uri';
import { LanguageSession, unwrap, type LanguageClient } from './language-session';

type NavigationContext = { projectId: string; taskId: string };
type Context = { ref: HostFileRef; root: HostFileRef; navigation: NavigationContext; refs: number };
type TrackedModel = {
  model: Monaco.editor.ITextModel;
  context: Context;
  selection: NonNullable<ReturnType<typeof selectLanguageServer>>;
  ready: Promise<void>;
  sessionId?: string;
  session?: LanguageSession;
  release?: () => Promise<void>;
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
      servers?: readonly LanguageServerDefinition[];
      openLocation(
        context: NavigationContext,
        ref: HostFileRef,
        range: Monaco.IRange
      ): boolean | Promise<boolean>;
    }
  ) {
    const languages = new Set(
      (options.servers ?? languageServers).flatMap((server) =>
        server.languages.map((language) => language.monacoLanguageId)
      )
    );
    const selector = [...languages].map((language) => ({ language, scheme: 'emdash-buffer' }));
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

  status(ref: HostFileRef): (LspState & { serverName: string }) | undefined {
    const id = encodeFacetUri(ref, { kind: 'buffer' });
    const state = this.states.get(id);
    const tracked = this.models.get(id);
    return state && tracked ? { ...state, serverName: tracked.selection.server.name } : undefined;
  }

  async restart(ref: HostFileRef): Promise<void> {
    const tracked = this.models.get(encodeFacetUri(ref, { kind: 'buffer' }));
    if (!tracked) return;
    await tracked.ready;
    if (tracked.session) await tracked.session.restart();
    else {
      tracked.ready = this.attach(tracked);
      await tracked.ready;
    }
  }

  async saved(ref: HostFileRef): Promise<void> {
    const tracked = this.models.get(encodeFacetUri(ref, { kind: 'buffer' }));
    if (!tracked) return;
    await tracked.ready;
    await tracked.session?.saved(ref.path);
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
    const selection = selectLanguageServer(
      context?.ref.path.segments.at(-1) ?? '',
      this.options.servers
    );
    if (!context || !selection || this.models.has(id)) return;
    const tracked: TrackedModel = {
      model,
      context,
      selection,
      ready: Promise.resolve(),
      change: model.onDidChangeContent(() => {
        this.monaco.editor.setModelMarkers(model, OWNER, []);
        tracked.session?.documents.changed();
      }),
    };
    this.models.set(id, tracked);
    tracked.ready = this.attach(tracked);
  }

  private async attach(tracked: TrackedModel): Promise<void> {
    const { model, context, selection } = tracked;
    const id = model.uri.toString();
    const current = () => !this.disposed && this.models.get(id) === tracked;
    const pending: LspState = {
      phase: 'starting',
      generation: '',
      diagnostics: [],
      capabilities: { hover: false, definition: false, typeDefinition: false, references: false },
    };
    runInAction(() => this.states.set(id, pending));
    try {
      const client = await this.options.client();
      if (!current()) return;
      const root = unwrap(
        await client.resolveProject({
          host: context.ref.host,
          workspaceRoot: context.root.path,
          path: context.ref.path,
          serverId: selection.server.id,
        })
      );
      if (!current()) return;
      const sessionId = JSON.stringify([
        encodeResourceUri(hostFileRef(context.ref.host, root)),
        selection.server.id,
      ]);
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = new LanguageSession(
          { clientId: this.clientId, host: context.ref.host, root, serverId: selection.server.id },
          this.options.client,
          (state) => this.update(sessionId, state)
        );
        this.sessions.set(sessionId, session);
      }
      tracked.sessionId = sessionId;
      tracked.session = session;
      tracked.release = session.documents.track(id, {
        path: context.ref.path,
        languageId: selection.language.languageId,
        getVersion: () => model.getVersionId(),
        getText: () => model.getValue(),
      });
      // A later document can join a session whose live state is already current.
      const shared = [...this.models.values()].find(
        (other) => other !== tracked && other.session === session
      );
      const state = shared && this.states.get(shared.model.uri.toString());
      if (state) this.update(sessionId, state);
    } catch (error) {
      if (current())
        runInAction(() =>
          this.states.set(id, {
            ...pending,
            phase: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        );
    }
  }

  private untrack(model: Monaco.editor.ITextModel): void {
    const id = model.uri.toString();
    const tracked = this.models.get(id);
    if (!tracked) return;
    this.models.delete(id);
    runInAction(() => this.states.delete(id));
    tracked.change.dispose();
    if (!tracked.context.refs) this.contexts.delete(id);
    const { session, sessionId, release } = tracked;
    if (!session || !sessionId || !release) return;
    void release()
      .catch((error) => session.fail(error))
      .then(async () => {
        if ([...this.models.values()].some((other) => other.session === session)) return;
        if (this.sessions.get(sessionId) === session) this.sessions.delete(sessionId);
        await session.dispose();
      });
  }

  private update(id: string, state: LspState): void {
    if (this.disposed) return;
    for (const { model, context, sessionId } of this.models.values()) {
      if (sessionId !== id) continue;
      runInAction(() => this.states.set(model.uri.toString(), state));
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
      // Root discovery is asynchronous. A sibling may already contain unsaved
      // edits while it is still waiting to join this language session.
      await Promise.all(
        [...this.models.values()]
          .filter(
            (other) =>
              other.selection.server.id === tracked.selection.server.id &&
              encodeResourceUri(other.context.root) === encodeResourceUri(tracked.context.root)
          )
          .map((other) => other.ready)
      );
      const session = tracked.session;
      if (!session || abort.signal.aborted || model.isDisposed()) return null;
      await session.documents.flush();
      if (abort.signal.aborted || model.isDisposed() || version !== model.getVersionId())
        return null;
      const result = await request(
        await session.ready,
        {
          session: session.key,
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
        tracked.session?.fail(error);
      return null;
    } finally {
      cancellation.dispose();
    }
  }
}

function toMonacoRange(range: LspLocation['range']): Monaco.IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}
