import type * as Monaco from 'monaco-editor';
import type { MonacoLanguageFallback } from './monaco-language-fallback';

type Model = Monaco.editor.ITextModel;
type Validation = {
  revision: number;
  host: boolean;
  timer?: ReturnType<typeof setTimeout>;
  change: Monaco.IDisposable;
};
const OWNER = 'emdash-language-services';

/** One marker owner per model: host publications supersede local validation, including empty ones. */
export class ModelDiagnostics {
  private readonly models = new Map<Model, Validation>();
  private readonly subscriptions: Monaco.IDisposable[];

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly local: Pick<MonacoLanguageFallback, 'diagnostics'>,
    private readonly onError: (error: unknown) => void
  ) {
    this.subscriptions = [
      monaco.editor.onDidCreateModel((model) => this.track(model)),
      monaco.editor.onWillDisposeModel((model) => this.untrack(model)),
      monaco.editor.onDidChangeModelLanguage(({ model }) => this.publish(model, undefined)),
      ...[
        monaco.typescript.typescriptDefaults,
        monaco.typescript.javascriptDefaults,
        monaco.json.jsonDefaults,
        monaco.css.cssDefaults,
        monaco.css.scssDefaults,
        monaco.css.lessDefaults,
      ].map((defaults) =>
        defaults.onDidChange(() => {
          for (const [model, state] of this.models) if (!state.host) this.schedule(model, state);
        })
      ),
    ];
    for (const model of monaco.editor.getModels()) this.track(model);
  }

  publish(model: Model, markers: Monaco.editor.IMarkerData[] | undefined): void {
    const state = this.models.get(model);
    if (!state || model.isDisposed()) return;
    state.host = markers !== undefined;
    state.revision++;
    clearTimeout(state.timer);
    this.monaco.editor.setModelMarkers(model, OWNER, markers ?? []);
    if (!state.host) this.schedule(model, state);
  }

  dispose(): void {
    for (const subscription of this.subscriptions) subscription.dispose();
    for (const model of this.models.keys()) this.untrack(model);
  }

  private track(model: Model): void {
    const state: Validation = {
      revision: 0,
      host: false,
      change: model.onDidChangeContent(() => this.publish(model, state.host ? [] : undefined)),
    };
    this.models.set(model, state);
    this.schedule(model, state);
  }

  private schedule(model: Model, state: Validation): void {
    clearTimeout(state.timer);
    const revision = ++state.revision;
    state.timer = setTimeout(() => {
      state.timer = undefined;
      void this.local
        .diagnostics(model)
        .then((markers) => {
          if (
            this.models.get(model) === state &&
            state.revision === revision &&
            !model.isDisposed()
          )
            this.monaco.editor.setModelMarkers(model, OWNER, markers);
        })
        .catch((error) => {
          if (this.models.get(model) === state && state.revision === revision) this.onError(error);
        });
    }, 500);
  }

  private untrack(model: Model): void {
    const state = this.models.get(model);
    if (!state) return;
    this.models.delete(model);
    clearTimeout(state.timer);
    state.change.dispose();
    this.monaco.editor.setModelMarkers(model, OWNER, []);
  }
}
